const truffleAssert = require('truffle-assertions');
const Remittance = artifacts.require("./Remittance.sol");

contract('Remittance', async accounts => {

    const { toBN } = web3.utils;
    const password = "password";
    const hash = await web3.utils.soliditySha3(password);
    const emptyErrorMsg = "Hash cannot be empty";
    const emptyHash = await web3.utils.fromAscii("");
    const emptySha3Hash = await web3.utils.soliditySha3("");
    const wrongHash = await web3.utils.soliditySha3("wrongPassword");

    const getFutureTimeStamp = (minsInFuture) => {
        return Math.floor(Date.now() / 1000) + minsInFuture * 60;
    };

    const checkEventNotEmitted = async () => {
        const result = await truffleAssert.createTransactionResult(remittance, remittance.transactionHash);

        await truffleAssert.eventNotEmitted(
            result
        );
    };

    const getGasCost = async txObj => {
        const tx = await web3.eth.getTransaction(txObj.tx);

        return toBN(txObj.receipt.gasUsed).mul(toBN(tx.gasPrice));
    };

    const expiryDate = getFutureTimeStamp(15);
    const expiredDate = getFutureTimeStamp(0);
    const [funder, broker] = accounts;
    const rehash = await web3.utils.soliditySha3(hash, broker);
    let remittance;

    beforeEach("Deploy and prepare", async function() {
        remittance = await Remittance.new({from: funder});
    });

    it("Funder creates a remittance", async () => {

        const txObj = await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});

        // Check contract's changed ETH balance
        const contractEthBalance = toBN(await web3.eth.getBalance(remittance.address));

        assert.strictEqual(contractEthBalance.toString(10), "2");

        truffleAssert.eventEmitted(txObj, 'RemittanceCreated', (ev) => {

            return  ev.hash === rehash &&
                    ev.funder === funder &&
                    ev.broker === broker &&
                    ev.amount.toString(10) === "2" &&
                    ev.expiryDate === expiryDate;
        }, 'RemittanceCreated event is emitted');

        const remittanceInstance = await remittance.remittances(rehash);

        assert.strictEqual(remittanceInstance.funder, funder);
        assert.strictEqual(remittanceInstance.broker, broker);
        assert.strictEqual(remittanceInstance.fundsOwed.toString(10), "2");
        assert.strictEqual(remittanceInstance.expiryDate.toString(10), expiryDate.toString(10));
        assert.isNotFalse(remittanceInstance.valid);
    });

    it("Broker releases funds to their account", async () => {

        await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});
        const initContractEthBalance = toBN(await web3.eth.getBalance(remittance.address));
        const initBrokerEthBalance = toBN(await web3.eth.getBalance(broker));

        const txObj = await remittance.release(hash, {from: broker});

        truffleAssert.eventEmitted(txObj, 'RemittanceFundsReleased', (ev) => {
            return  ev.hash === rehash &&
                    ev.broker === broker &&
                    ev.amount.toString(10) === "2";
        }, 'RemittanceFundsReleased event is emitted');

        const remittanceInstance = await remittance.remittances(rehash);

        assert.strictEqual(remittanceInstance.fundsOwed.toString(10), "0");
        assert.strictEqual(remittanceInstance.expiryDate.toString(10), "0");

        // Check the remittance amount has been taken from the contract eth balance
        const contractEthBalance = toBN(await web3.eth.getBalance(remittance.address));
        const expectedContractEthBalance = initContractEthBalance.sub(toBN(2)).toString(10);
        assert.strictEqual(contractEthBalance.toString(10), expectedContractEthBalance);

        // Check the remittance amount has been sent to the broker eth balance
        const brokerEthBalance = toBN(await web3.eth.getBalance(broker));
        const cost = await getGasCost(txObj);
        const expectedBrokerEthBalance = initBrokerEthBalance.add(toBN(2)).sub(toBN(cost)).toString(10);
        assert.equal(brokerEthBalance.toString(10), expectedBrokerEthBalance);

    });

    it("Funder reclaims funds", async () => {
        await remittance.create(hash, broker, expiredDate, {from: funder, value: 2});
        const initContractEthBalance = toBN(await web3.eth.getBalance(remittance.address));
        const initFunderEthBalance = toBN(await web3.eth.getBalance(funder));

        const txObj = await remittance.reclaim(hash, broker, {from: funder});

        truffleAssert.eventEmitted(txObj, 'RemittanceFundsReclaimed', (ev) => {
            return  ev.hash === rehash &&
                    ev.funder === funder &&
                    ev.amount.toString(10) === "2";
        }, 'RemittanceFundsReclaimed event is emitted');

        // Check the remittance amount has been taken from the contract eth balance
        const contractEthBalance = toBN(await web3.eth.getBalance(remittance.address));
        const expectedContractEthBalance = initContractEthBalance.sub(toBN(2)).toString(10);
        assert.strictEqual(contractEthBalance.toString(10), expectedContractEthBalance);

        // Check the remittance amount has been sent to the funder eth balance
        const funderEthBalance = toBN(await web3.eth.getBalance(funder));
        const cost = await getGasCost(txObj);
        const expectedFunderEthBalance = initFunderEthBalance.add(toBN(2)).sub(toBN(cost)).toString(10);
        assert.strictEqual(funderEthBalance.toString(10), expectedFunderEthBalance);

    });

    it("Creating a remittance reverts using a zero length hash", async () => {

        await truffleAssert.reverts(
            remittance.create(emptyHash, broker, expiryDate, {from: funder, value: 2}),
            emptyErrorMsg
        );
        checkEventNotEmitted();

        await truffleAssert.reverts(
            remittance.create(emptySha3Hash, broker, expiryDate, {from: funder, value: 2}),
            emptyErrorMsg
        );
        checkEventNotEmitted();
    });

    it("Creating a remittance reverts if the caller is the same as the broker", async () => {

        await truffleAssert.reverts(
            remittance.create(hash, funder, expiryDate, {from: funder, value: 2}),
            "The caller cannot be the broker"
        );
        checkEventNotEmitted();
    });


    it("Creating a remittance reverts if the deposit amount is zero", async () => {

        await truffleAssert.reverts(
            remittance.create(hash, broker, expiryDate, {from: funder, value: 0}),
            "The amount must be greater than 0"
        );
        checkEventNotEmitted();
    });


    it("Releasing funds reverts when using a zero length hash", async () => {

        await truffleAssert.reverts(
            remittance.release(emptyHash, {from: broker}),
            emptyErrorMsg
        );
        checkEventNotEmitted();

        await truffleAssert.reverts(
            remittance.release(emptySha3Hash, {from: broker}),
            emptyErrorMsg
        );
        checkEventNotEmitted();
    });

    it("Releasing funds reverts when hash is invalid", async () => {

        await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});

        await truffleAssert.reverts(
            remittance.release(wrongHash, {from: broker}),
            "No remittance found"
        );
        checkEventNotEmitted();

        await truffleAssert.reverts(
            remittance.release(hash, {from: funder}),
            "No remittance found"
        );
        checkEventNotEmitted();

    });

    it("Releasing funds reverts when the funds are zero", async () => {

        await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});
        await remittance.release(hash, {from: broker});

        // re-attempt
        await truffleAssert.reverts(
            remittance.release(hash, {from: broker}),
            "No funds available"
        );
        checkEventNotEmitted();
    });

    it("Releasing funds reverts when the remittance has expired", async () => {

        const expiredDate = getFutureTimeStamp(0);

        await remittance.create(hash, broker, expiredDate, {from: funder, value: 2});

        await truffleAssert.reverts(
            remittance.release(hash, {from: broker}),
            "The remittance has expired"
        );
        checkEventNotEmitted();
    });

    it("Reclaiming funds reverts when using a zero length hash", async () => {

        await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});
        await remittance.release(hash, {from: broker});

        await truffleAssert.reverts(
            remittance.reclaim(emptyHash, broker, {from: funder}),
            emptyErrorMsg
        );
        checkEventNotEmitted();

        await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});
        await remittance.release(hash, {from: broker});

        await truffleAssert.reverts(
            remittance.reclaim(emptySha3Hash, broker, {from: funder}),
            emptyErrorMsg
        );
        checkEventNotEmitted();
    });

    it("Reclaiming funds reverts when hash is invalid", async () => {

        await remittance.create(hash, broker, expiredDate, {from: funder, value: 2});

        await truffleAssert.reverts(
            remittance.reclaim(wrongHash, broker, {from: funder}),
            "No remittance found"
        );
        checkEventNotEmitted();
    });


    it("Releasing funds reverts when the funds are zero", async () => {

        await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});
        await remittance.release(hash, {from: broker});

        // re-attempt
        await truffleAssert.reverts(
            remittance.reclaim(hash, broker, {from: funder}),
            "No funds available"
        );
        checkEventNotEmitted();
    });

    it("Releasing funds reverts when expiryDate has not transpired", async () => {

        await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});

        // re-attempt
        await truffleAssert.reverts(
            remittance.reclaim(hash, broker, {from: funder}),
            "The remittance has not passed"
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


    it("Create is pausable and unpausable", async () => {

        await remittance.pause({from: funder});

        await truffleAssert.reverts(
            remittance.create(hash, broker, expiryDate, {from: funder, value: 2}),
            "Pausable: paused"
        );
        checkEventNotEmitted();

        await remittance.unpause({from: funder});
        const txObj = await remittance.create(hash, broker, 2, {from: funder, value: 2});

        truffleAssert.eventEmitted(txObj, 'RemittanceCreated');
    });

    it("Release is pausable and unpausable", async () => {

       await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});
       await remittance.pause({from: funder});

        await truffleAssert.reverts(
            remittance.release(hash, {from: broker}),
            "Pausable: paused"
        );
        checkEventNotEmitted();

        await remittance.unpause({from: funder});
        const txObj = await remittance.release(hash, {from: broker});
        truffleAssert.eventEmitted(txObj, 'RemittanceFundsReleased');
    });

    it("Reclaim is pausable and unpausable", async () => {

        await remittance.create(hash, broker, expiredDate, {from: funder, value: 2});
        await remittance.pause({from: funder});

        await truffleAssert.reverts(
            remittance.reclaim(hash, broker, {from: funder}),
            "Pausable: paused"
        );
        checkEventNotEmitted();

        await remittance.unpause({from: funder});
        const txObj = await remittance.reclaim(hash, broker, {from: funder});
        truffleAssert.eventEmitted(txObj, 'RemittanceFundsReclaimed');
    });
});
