const truffleAssert = require('truffle-assertions');
const Remittance = artifacts.require("./Remittance.sol");

contract('Remittance', async accounts => {

    const { toBN } = web3.utils;
    const concatPassword = "password1" + "password2";
    const hash = await web3.utils.soliditySha3(concatPassword);

    const getGasCost = async txObj => {
        const tx = await web3.eth.getTransaction(txObj.tx);

        return toBN(txObj.receipt.gasUsed).mul(toBN(tx.gasPrice));
    };

    const checkEventNotEmitted = async () => {
        const result = await truffleAssert.createTransactionResult(remittance, remittance.transactionHash);

        await truffleAssert.eventNotEmitted(
            result
        );
    };

    const [funder, broker] = accounts;
    let remittance;

    beforeEach("Deploy and prepare", async function() {
        remittance = await Remittance.new({from: funder});
    });

    it("Funder can deposit 5 wei into their account", async () => {

        const depositAmount = "5"
        const txObj = await remittance.deposit({from: funder, value: depositAmount});

        // Check contract's changed ETH balance contains 5 wei
        const contractEthBalance = toBN(await web3.eth.getBalance(remittance.address));
        assert.strictEqual(contractEthBalance.toString(10), depositAmount);

        // Check funder's contract balance is topped up with 5 wei
        const funderOwed = await remittance.balances(funder);
        assert.strictEqual(funderOwed.toString(10), depositAmount);

        truffleAssert.eventEmitted(txObj, 'Deposit', (ev) => {
            return  ev.depositor === funder &&
                    ev.amount.toString(10) === depositAmount;
        }, 'Deposit event is emitted')

    });

    it("Funder creates a remittance", async () => {

        const remittanceAmount = "2";
        await remittance.deposit({from: funder, value: 5});
        const txObj = await remittance.create(hash, broker, remittanceAmount, {from: funder});

        truffleAssert.eventEmitted(txObj, 'RemittanceCreated', (ev) => {
            return  ev.hash === hash &&
                    ev.funder === funder &&
                    ev.broker === broker &&
                    ev.amount.toString(10) === remittanceAmount;
        }, 'RemittanceCreated event is emitted');

        const remittanceInstance = await remittance.remittances(hash);

        assert.strictEqual(remittanceInstance.funder, funder);
        assert.strictEqual(remittanceInstance.broker, broker);
        assert.strictEqual(remittanceInstance.amount.toString(10), remittanceAmount);
        assert.strictEqual(remittanceInstance.fundsReleased, false);
    });

    it("Broker releases funds from the funder's balance to their balance", async () => {

        const remittanceAmount = "2";
        await remittance.deposit({from: funder, value: 5});
        await remittance.create(hash, broker, remittanceAmount, {from: funder});

        const txObj = await remittance.release(concatPassword, {from: broker});

        truffleAssert.eventEmitted(txObj, 'RemittanceFundsReleased', (ev) => {
            return  ev.hash === hash &&
                    ev.broker === broker &&
                    ev.amount.toString(10) === remittanceAmount;
        }, 'RemittanceFundsReleased event is emitted');

        // Check funder's changed contract balance is now reduced from 5 to 3 wei
        const funderOwed = await remittance.balances(funder);
        assert.strictEqual(funderOwed.toString(10), "3");

        // Check broker's changed contract balance now contains 2 wei
        const brokerOwed = await remittance.balances(broker);
        assert.strictEqual(brokerOwed.toString(10), remittanceAmount);

        // Check funds released is set to true
        const remittanceInstance = await remittance.remittances(hash);
        assert.strictEqual(remittanceInstance.fundsReleased, true);

    });

    it('Broker withdraws remittance after releasing funds into their balance', async () => {

        const withDrawAmount = toBN(2);
        await remittance.deposit({from: funder, value: 5});
        await remittance.create(hash, broker, withDrawAmount, {from: funder});
        await remittance.release(concatPassword, {from: broker});

        const initContractEthBalance = toBN(await web3.eth.getBalance(remittance.address));
        const initBrokerEthBalance = toBN(await web3.eth.getBalance(broker));

        const txObj = await remittance.withdraw(withDrawAmount, {from: broker});

        // Check broker's new Ether balance
        const cost = toBN(await getGasCost(txObj));
        const brokerEthBalance = toBN(await web3.eth.getBalance(broker));
        const expectedBrokerEthBalance = initBrokerEthBalance.sub(cost).add(withDrawAmount).toString(10);
        assert.strictEqual(brokerEthBalance.toString(10), expectedBrokerEthBalance);

        // Check contract's new Ether balance
        const contractEthBalance = toBN(await web3.eth.getBalance(remittance.address));
        const expectedContractEthBalance = initContractEthBalance.sub(withDrawAmount).toString(10);
        assert.strictEqual(contractEthBalance.toString(10), expectedContractEthBalance);

        truffleAssert.eventEmitted(txObj, 'WithDraw', (ev) => {
            return  ev.withdrawer === broker &&
                    ev.amount.toString(10) === withDrawAmount.toString(10);
        }, 'WithDraw event is emitted');
    });

    it("Deposit reverts if the deposit amount is zero", async () => {
        await truffleAssert.reverts(
            remittance.deposit({from: funder, value: 0}),
            "The value must be greater than 0"
        );
        checkEventNotEmitted();
    });

    it("Creating a remittance reverts if the caller is the same as the broker", async () => {

        const errorMsg = "The caller cannot be the broker";

        await truffleAssert.reverts(
            remittance.create(hash, funder, toBN(2), {from: funder}),
            errorMsg
        );
        checkEventNotEmitted();
    });

    it("Creating a remittance reverts if the amount is 0", async () => {
        await truffleAssert.reverts(
            remittance.create(hash, broker, 0, {from: funder}),
            "The amount must be greater than 0"
        );
        checkEventNotEmitted();
    });

    it("Creating a remittance reverts if the amount exceeds the funder's balance", async () => {
        await truffleAssert.reverts(
            remittance.create(hash, broker, 2, {from: funder}),
            "There are insufficient funds in the funder's account to create this remittance"
        );
        checkEventNotEmitted();
    });

    it("Releasing funds reverts when using a zero length password", async () => {
        await truffleAssert.reverts(
            remittance.release("", {from: broker}),
            "The concatenated password cannot be empty"
        );
        checkEventNotEmitted();
    });

    it("Releasing funds reverts when the sender is not the broker", async () => {
        await truffleAssert.reverts(
            remittance.release(concatPassword, {from: funder}),
            "Only the broker can release funds for this remittance"
        );
        checkEventNotEmitted();
    });

    it("Releasing funds reverts when the broker does not have sufficient funds", async () => {

        await remittance.deposit({from: funder, value: 5});
        await remittance.create(hash, broker, 2, {from: funder});
        const funderOwed = await remittance.balances(funder);

        //Empty funder balance account
        await remittance.withdraw(funderOwed, {from: funder});

        await truffleAssert.reverts(
            remittance.release(concatPassword, {from: broker}),
            "There are insufficient funds available in the funder's contract balance"
        );
        checkEventNotEmitted();
    });

    it("Withdrawing funds reverts when amount is zero", async () => {

        await remittance.deposit({from: funder, value: 5});

        await truffleAssert.reverts(
            remittance.withdraw(0, {from: funder}),
            "The value must be greater than 0"
        );
        checkEventNotEmitted();
    });

    it("Withdrawing funds reverts when the withdrawer has insufficient funds", async () => {

        await truffleAssert.reverts(
            remittance.withdraw(1, {from: broker}),
            "There are insufficient funds"
        );
        checkEventNotEmitted();
    });

    it("Remittance can only be paused by the owner", async () => {

        await truffleAssert.reverts(
            remittance.pause({from: broker}),
            "Ownable: caller is not the owner"
        );

        await truffleAssert.reverts(
            remittance.unpause({from: broker}),
            "Ownable: caller is not the owner"
        );
    });

    it("Deposit is pausable and unpausable", async () => {

        await remittance.pause({from: funder});

        await truffleAssert.reverts(
            remittance.deposit({from: funder, value: 5}),
            "Pausable: paused"
        );
        checkEventNotEmitted();

        await remittance.unpause({from: funder});
        const txObj = await remittance.deposit({from: funder, value: 5});

        truffleAssert.eventEmitted(txObj, 'Deposit');
    });

    it("Create is pausable and unpausable", async () => {

        await remittance.deposit({from: funder, value: 5}),
        await remittance.pause({from: funder});

        await truffleAssert.reverts(
            remittance.create(hash, broker, 2, {from: funder}),
            "Pausable: paused"
        );
        checkEventNotEmitted();

        await remittance.unpause({from: funder});
        const txObj = await remittance.create(hash, broker, 2, {from: funder});

        truffleAssert.eventEmitted(txObj, 'RemittanceCreated');
    });

    it("Release is pausable and unpausable", async () => {

        await remittance.deposit({from: funder, value: 5}),
        await remittance.create(hash, broker, 5, {from: funder});
        await remittance.pause({from: funder});

        await truffleAssert.reverts(
            remittance.release(concatPassword, {from: broker}),
            "Pausable: paused"
        );
        checkEventNotEmitted();

    });

    it("Withdraw is pausable and unpausable", async () => {

        await remittance.deposit({from: funder, value: 5});
        await remittance.pause({from: funder});

        await truffleAssert.reverts(
            remittance.withdraw(1, {from: funder}),
            "Pausable: paused"
        );
        checkEventNotEmitted();
    });

});































