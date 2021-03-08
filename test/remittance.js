const truffleAssert = require('truffle-assertions');
const timeMachine = require('ganache-time-traveler');
const Remittance = artifacts.require("./Remittance.sol");

contract('Remittance', async accounts => {

    const { toBN, soliditySha3} = web3.utils;
    const password = "password";
    const hash = await soliditySha3(password);
    const emptyErrorMsg = "Hash cannot be empty";
    const noFundsAvailable = "No funds available";
    const emptyHash = await web3.utils.fromAscii("");
    const emptySha3Hash = await soliditySha3("");
    const wrongHash = await soliditySha3("wrongPassword");
    const zeroAddress = "0x0000000000000000000000000000000000000000";
    const day24hourinSecs = 86400;

    const futureTimeStamp = () => {
        return Math.floor(Date.now() / 1000) + day24hourinSecs;
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

    const [funder, broker] = accounts;
    const rehash = await soliditySha3(hash, broker);
    let remittance;

    beforeEach("Deploy and prepare", async function() {
        remittance = await Remittance.new({from: funder});
        snapShot = await timeMachine.takeSnapshot();
        snapshotId = snapShot['result'];
    });
    afterEach(async() => {
        await timeMachine.revertToSnapshot(snapshotId);
    });

    it("Funder creates a remittance", async () => {

        let expiryDate = futureTimeStamp();
        const txObj = await remittance.create(rehash, broker, expiryDate, {from: funder, value: 2});

        // Check contract's changed ETH balance
        const contractEthBalance = toBN(await web3.eth.getBalance(remittance.address));

        assert.strictEqual(contractEthBalance.toString(10), "2");

        await truffleAssert.eventEmitted(txObj, 'RemittanceFundsCreated', (ev) => {

            return  ev.hash === rehash &&
                    ev.funder === funder &&
                    ev.broker === broker &&
                    ev.amount.toString(10) === "2" &&
                    ev.expiryDate.toString(10) === expiryDate.toString(10);
        }, 'RemittanceFundsCreated event is emitted');

        const remittanceInstance = await remittance.remittances(rehash);

        assert.strictEqual(remittanceInstance.funder, funder);
        assert.strictEqual(remittanceInstance.fundsOwed.toString(10), "2");
        assert.strictEqual(remittanceInstance.expiryDate.toString(10), expiryDate.toString(10));
    });

    it("Broker releases funds to their account", async () => {

        let expiryDate = futureTimeStamp();

        await remittance.create(rehash, broker, expiryDate, {from: funder, value: 2});
        const initContractEthBalance = toBN(await web3.eth.getBalance(remittance.address));
        const initBrokerEthBalance = toBN(await web3.eth.getBalance(broker));

        const txObj = await remittance.release(hash, {from: broker});

        await truffleAssert.eventEmitted(txObj, 'RemittanceFundsReleased', (ev) => {
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

    it("Funder reclaims funds from an expired remittance", async () => {

        let expiryDate = futureTimeStamp();

        //Create a remittance with an expired date
        await remittance.create(rehash, broker, expiryDate, {from: funder, value: 2});
        const initContractEthBalance = toBN(await web3.eth.getBalance(remittance.address));
        const initFunderEthBalance = toBN(await web3.eth.getBalance(funder));
        await timeMachine.advanceTimeAndBlock(day24hourinSecs);

        const txObj = await remittance.reclaim(rehash, {from: funder});

        await truffleAssert.eventEmitted(txObj, 'RemittanceFundsReclaimed', (ev) => {
            return  ev.hash === rehash &&
                    ev.funder === funder &&
                    ev.amount.toString(10) === "2";
        }, 'RemittanceFundsReclaimed event is emitted');

        const remittanceInstance = await remittance.remittances(rehash);
        assert.strictEqual(remittanceInstance.fundsOwed.toString(10), "0");
        assert.strictEqual(remittanceInstance.expiryDate.toString(10), "0");

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

    it("Call public password hashing function", async () => {
        const hashedPassword = await remittance.keccak256Password(password);

        assert.strictEqual(hashedPassword, hash);
    });

    it("Call public password hash and broker rehashing function", async () => {
        const reHashedPassword = await remittance.keccak256PasswordHashBroker(hash, broker);

        assert.strictEqual(reHashedPassword, rehash);
    });

    it("Creating a remittance reverts using a zero length hash", async () => {

        let expiryDate = futureTimeStamp();

        await truffleAssert.reverts(
            remittance.create(emptyHash, broker, expiryDate, {from: funder, value: 2}),
            emptyErrorMsg
        );
        checkEventNotEmitted();

        expiryDate = futureTimeStamp();

        await truffleAssert.reverts(
            remittance.create(emptySha3Hash, broker, expiryDate, {from: funder, value: 2}),
            emptyErrorMsg
        );
        checkEventNotEmitted();
    });

    it("Creating a remittance reverts if the caller is the same as the broker", async () => {

        let expiryDate = futureTimeStamp();

        await truffleAssert.reverts(
            remittance.create(hash, funder, expiryDate, {from: funder, value: 2}),
            "Caller cannot be the broker"
        );
        checkEventNotEmitted();
    });

    it("Creating a remittance reverts when a zero address is used", async () => {

        let expiryDate = futureTimeStamp();

        await truffleAssert.reverts(
            remittance.create(hash, zeroAddress, expiryDate, {from: funder, value: 2}),
            "Address cannot be zero"
        );
        checkEventNotEmitted();
    });

    it("Creating a remittance reverts if the deposit amount is zero", async () => {

        let expiryDate = futureTimeStamp();

        await truffleAssert.reverts(
            remittance.create(hash, broker, expiryDate, {from: funder, value: 0}),
            "Amount must be greater than 0"
        );
        checkEventNotEmitted();
    });

    it("Creating a remittance reverts if identical arguments are submitted", async () => {

        let expiryDate = futureTimeStamp();
        await remittance.create(rehash, broker, expiryDate, {from: funder, value: 2});

        await truffleAssert.reverts(
            remittance.create(rehash, broker, expiryDate, {from: funder, value: 2}),
            "Remittance already exists"
        );
        checkEventNotEmitted();
    });

    it("Releasing funds reverts when using a zero length hash", async () => {

        let expiryDate = futureTimeStamp();
        await remittance.create(rehash, broker, expiryDate, {from: funder, value: 2});

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

        let expiryDate = futureTimeStamp();
        await remittance.create(rehash, broker, expiryDate, {from: funder, value: 2});

        await truffleAssert.reverts(
            remittance.release(wrongHash, {from: broker}),
            noFundsAvailable
        );
        checkEventNotEmitted();

        await truffleAssert.reverts(
            remittance.release(hash, {from: funder}),
            noFundsAvailable
        );
        checkEventNotEmitted();

    });

    it("Releasing funds reverts when the funds are zero", async () => {

        let expiryDate = futureTimeStamp();
        await remittance.create(rehash, broker, expiryDate, {from: funder, value: 2});
        await remittance.release(hash, {from: broker});

        // re-attempt
        await truffleAssert.reverts(
            remittance.release(hash, {from: broker}),
            noFundsAvailable
        );
        checkEventNotEmitted();
    });

    it("Releasing funds reverts when the remittance has expired", async () => {

        let expiryDate = futureTimeStamp();
        await remittance.create(rehash, broker, expiryDate, {from: funder, value: 2});
        await timeMachine.advanceTimeAndBlock(day24hourinSecs + 1);

        await truffleAssert.reverts(
            remittance.release(hash, {from: broker}),
            "Remittance has expired"
        );
        checkEventNotEmitted();
    });

    it("Reclaiming funds reverts when using a zero length hash", async () => {

        let expiryDate = futureTimeStamp();
        await remittance.create(rehash, broker, expiryDate, {from: funder, value: 2});
        await timeMachine.advanceTimeAndBlock(day24hourinSecs);

        await truffleAssert.reverts(
            remittance.reclaim(emptyHash, {from: funder}),
            emptyErrorMsg
        );
        checkEventNotEmitted();

    });

    it("Reclaiming funds reverts when using a zero length sha3 hash", async () => {

        let expiryDate = futureTimeStamp();
        await remittance.create(rehash, broker, expiryDate, {from: funder, value: 2});
        await timeMachine.advanceTimeAndBlock(day24hourinSecs);

        await truffleAssert.reverts(
            remittance.reclaim(emptySha3Hash, {from: funder}),
            emptyErrorMsg
        );
        checkEventNotEmitted();
    });

    it("Reclaiming funds reverts when hash is invalid", async () => {

        let expiryDate = futureTimeStamp();
        await remittance.create(rehash, broker, expiryDate, {from: funder, value: 2});
        await timeMachine.advanceTimeAndBlock(day24hourinSecs);

        await truffleAssert.reverts(
            remittance.reclaim(wrongHash, {from: funder}),
            noFundsAvailable
        );
        checkEventNotEmitted();
    });

    it("Reclaiming funds reverts when the funds are zero", async () => {

        let expiryDate = futureTimeStamp(day24hourinSecs);
        await remittance.create(rehash, broker, expiryDate, {from: funder, value: 2});
        await remittance.release(hash, {from: broker});
        await timeMachine.advanceTimeAndBlock(day24hourinSecs);

        // re-attempt
        await truffleAssert.reverts(
            remittance.reclaim(rehash, {from: funder}),
            noFundsAvailable
        );
        checkEventNotEmitted();
    });

    it("Reclaiming funds reverts when expiryDate has not expired", async () => {

        let expiryDate = futureTimeStamp();
        await remittance.create(rehash, broker, expiryDate, {from: funder, value: 2});

        // re-attempt
        await truffleAssert.reverts(
            remittance.reclaim(rehash, {from: funder}),
            "The remittance has not expired"
        );
        checkEventNotEmitted();
    });

    it("Creating a hash with an empty string reverts", async () => {
        await truffleAssert.reverts(
            remittance.keccak256Password("", {from: broker}),
            "Non-empty string required"
        );
    });

    it("Rehashing using a hash with a zero length hash reverts", async () => {

        await truffleAssert.reverts(
            remittance.keccak256PasswordHashBroker(emptyHash, broker),
            emptyErrorMsg
        );

        await truffleAssert.reverts(
            remittance.keccak256PasswordHashBroker(emptySha3Hash, broker),
            emptyErrorMsg
        );
    });

    it("Rehashing using a zero address reverts", async () => {
        await truffleAssert.reverts(
            remittance.keccak256PasswordHashBroker(hash, zeroAddress),
            "Address cannot be zero"
        );
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

        let expiryDate = futureTimeStamp();
        await remittance.pause({from: funder});

        await truffleAssert.reverts(
            remittance.create(hash, broker, expiryDate, {from: funder, value: 2}),
            "Pausable: paused"
        );
        checkEventNotEmitted();

        expiryDate = futureTimeStamp();
        await remittance.unpause({from: funder});
        const txObj = await remittance.create(rehash, broker, expiryDate, {from: funder, value: 2});

        await truffleAssert.eventEmitted(txObj, 'RemittanceFundsCreated');
    });

    it("Release is pausable and unpausable", async () => {

       let expiryDate = futureTimeStamp();
       await remittance.create(rehash, broker, expiryDate, {from: funder, value: 2});
       await remittance.pause({from: funder});

        await truffleAssert.reverts(
            remittance.release(hash, {from: broker}),
            "Pausable: paused"
        );
        checkEventNotEmitted();

        await remittance.unpause({from: funder});
        const txObj = await remittance.release(hash, {from: broker});
        await truffleAssert.eventEmitted(txObj, 'RemittanceFundsReleased');
    });

    it("Reclaim is pausable and unpausable", async () => {

        let expiryDate = futureTimeStamp();
        await remittance.create(rehash, broker, expiryDate, {from: funder, value: 2});
        await timeMachine.advanceTimeAndBlock(day24hourinSecs);
        await remittance.pause({from: funder});

        await truffleAssert.reverts(
            remittance.reclaim(rehash, {from: funder}),
            "Pausable: paused"
        );
        checkEventNotEmitted();

        await remittance.unpause({from: funder});
        const txObj = await remittance.reclaim(rehash, {from: funder});
        await truffleAssert.eventEmitted(txObj, 'RemittanceFundsReclaimed');
    });
});
