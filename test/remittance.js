const truffleAssert = require('truffle-assertions');
const Remittance = artifacts.require("./Remittance.sol");

contract('Remittance', async accounts => {

    const { toBN } = web3.utils;
    const concatPassword = "password1" + "password2";

    const getGasCost = async txObj => {
        const tx = await web3.eth.getTransaction(txObj.tx);

        return toBN(txObj.receipt.gasUsed).mul(toBN(tx.gasPrice));
    };

    const [funder, broker, recipient] = accounts;
    let remittance;
``
    beforeEach("Deploy and prepare", async function() {
        remittance = await Remittance.new({from: funder});
    });

    it('Sender can deposit 5 wei into the broker account', async () => {
        const txObj = await remittance.deposit({from: funder, value: 5});

        truffleAssert.eventEmitted(txObj, 'Deposit', (ev) => {
            return  ev.depositor === funder &&
                ev.amount.toString(10) === "5";
        }, 'Deposit event is emitted');

        // Check contract's changed ETH balance
        const contractEthBalance = toBN(await web3.eth.getBalance(remittance.address));
        assert.strictEqual(contractEthBalance.toString(10), "5");
    });

    it('RemittanceContract is created', async () => {

        await remittance.deposit({from: funder, value: toBN(5)});
        const hash = await web3.utils.soliditySha3(concatPassword);
        const txObj = await remittance.create(hash, broker, recipient, toBN(2), {from: funder});

        // Check broker's changed contract balance
        const brokerContractBalance = await remittance.balances(broker);
        assert.strictEqual(brokerContractBalance.toString(10), "2");

        truffleAssert.eventEmitted(txObj, 'RemittanceContractCreated', (ev) => {
            return  ev.hash === hash &&
                ev.funder === funder &&
                ev.broker === broker &&
                ev.recipient === recipient &&
                ev.amount.toString(10) === "2";
        }, 'RemittanceContractCreated event is emitted');

        const remittanceContract = await remittance.contracts(hash);

        assert.strictEqual(remittanceContract.funder, funder);
        assert.strictEqual(remittanceContract.broker, broker);
        assert.strictEqual(remittanceContract.recipient, recipient);
        assert.strictEqual(remittanceContract.amount.toString(10), "2");
        assert.strictEqual(remittanceContract.fundsReleased, false);
    });

    it('Broker withdraws eth on behalf of the recipient', async () => {

        const initBrokerEthBalance = toBN(await web3.eth.getBalance(broker));
        await remittance.deposit({from: funder, value: toBN(5)});
        const hash = await web3.utils.soliditySha3(concatPassword);
        await remittance.create(hash, broker, recipient, toBN(2), {from: funder});

        const txObj = await remittance.withdraw(concatPassword, {from: broker});

        truffleAssert.eventEmitted(txObj, 'WithDraw', (ev) => {
            return  ev.broker === broker &&
                ev.hash === hash &&
                ev.amount.toString(10) === "2";
        }, 'WithDraw event is emitted');

        // Check broker's changed contract balance
        const brokerContractBalance = await remittance.balances(broker);
        assert.strictEqual(brokerContractBalance.toString(10), "0");

        // Check broker's new Ether balance
        const cost = toBN(await getGasCost(txObj));
        const brokerEthBalance = toBN(await web3.eth.getBalance(broker));
        const expectedBrokerEthBalance = initBrokerEthBalance.sub(cost).add(toBN(2)).toString(10);
        assert.strictEqual(brokerEthBalance.toString(10), expectedBrokerEthBalance);

        // Check funds released
        const remittanceContract = await remittance.contracts(hash);
        assert.strictEqual(remittanceContract.fundsReleased, true);
    });
});
