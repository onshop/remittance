const truffleAssert = require('truffle-assertions');
const timeMachine = require('ganache-time-traveler');
const Remittance = artifacts.require("./Remittance.sol");

contract('Remittance', async accounts => {

    const { toBN, soliditySha3, asciiToHex } = web3.utils;
    const { getBalance } = web3.eth;
    const passwordString = "password";
    const wrongPasswordString = "wrongPassword";
    const emptyPasswordErrorMsg = "Password cannot be empty";
    const emptyHashErrorMsg = "Hash cannot be empty";
    const noFundsAvailableMsg = "No funds available";
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
    const passwordBytes32 = await soliditySha3(passwordString);
    const zeroPassBytes32 = await asciiToHex("");
    const emptySha3Hash = await soliditySha3("");
    const wrongPassBytes32 = await soliditySha3(wrongPasswordString);
    let hash;
    let remittance;
    let snapshotId;

    beforeEach("Deploy and prepare", async function() {
        remittance = await Remittance.new({from: funder});
        hash = await soliditySha3(passwordBytes32, broker, remittance.address);
        const snapShot = await timeMachine.takeSnapshot();
        snapshotId = snapShot['result'];
    });
    afterEach(async() => {
        await timeMachine.revertToSnapshot(snapshotId);
    });

    it("Funder creates a remittance", async () => {

        const expiryDate = futureTimeStamp();
        const txObj = await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});

        // Check contract's changed ETH balance
        const contractEthBalance = toBN(await getBalance(remittance.address));

        assert.strictEqual(contractEthBalance.toString(10), "2");

        await truffleAssert.eventEmitted(txObj, 'RemittanceFundsCreated', (ev) => {

            return  ev.hash === hash &&
                ev.funder === funder &&
                ev.broker === broker &&
                ev.amount.toString(10) === "2" &&
                ev.expiryDate.toString(10) === expiryDate.toString(10);
        }, 'RemittanceFundsCreated event is emitted');

        const remittanceInstance = await remittance.remittances(hash);

        assert.strictEqual(remittanceInstance.funder, funder);
        assert.strictEqual(remittanceInstance.fundsOwed.toString(10), "2");
        assert.strictEqual(remittanceInstance.expiryDate.toString(10), expiryDate.toString(10));

    });

    it("Broker releases funds to their account", async () => {

        const expiryDate = futureTimeStamp();
        await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});

        const initContractEthBalance = toBN(await getBalance(remittance.address));
        assert.strictEqual(initContractEthBalance.toString(10), "2");

        const initBrokerEthBalance = toBN(await getBalance(broker));

        const txObj = await remittance.release(passwordBytes32, {from: broker});

        await truffleAssert.eventEmitted(txObj, 'RemittanceFundsReleased', (ev) => {
            return  ev.hash === hash &&
                    ev.password === passwordBytes32 &&
                    ev.broker === broker &&
                    ev.amount.toString(10) === "2";
        }, 'RemittanceFundsReleased event is emitted');

        const remittanceInstance = await remittance.remittances(hash);

        assert.strictEqual(remittanceInstance.fundsOwed.toString(10), "0");
        assert.strictEqual(remittanceInstance.expiryDate.toString(10), "0");

        // Check the remittance amount has been taken from the contract eth balance
        const contractEthBalance = toBN(await getBalance(remittance.address));
        assert.strictEqual(contractEthBalance.toString(10), "0");

        // Check the remittance amount has been sent to the broker eth balance
        const brokerEthBalance = toBN(await getBalance(broker));
        const cost = await getGasCost(txObj);
        const expectedBrokerEthBalance = initBrokerEthBalance.add(toBN(2)).sub(cost).toString(10);
        assert.equal(brokerEthBalance.toString(10), expectedBrokerEthBalance);

    });

    it("Funder reclaims funds from an expired remittance", async () => {

        const expiryDate = futureTimeStamp();

        //Create a remittance with an expired date
        await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});
        const initFunderEthBalance = toBN(await getBalance(funder));
        await timeMachine.advanceTimeAndBlock(day24hourinSecs);

        const txObj = await remittance.reclaim(hash, {from: funder});

        await truffleAssert.eventEmitted(txObj, 'RemittanceFundsReclaimed', (ev) => {
            return  ev.hash === hash &&
                    ev.funder === funder &&
                    ev.amount.toString(10) === "2";
        }, 'RemittanceFundsReclaimed event is emitted');

        const remittanceInstance = await remittance.remittances(hash);
        assert.strictEqual(remittanceInstance.fundsOwed.toString(10), "0");
        assert.strictEqual(remittanceInstance.expiryDate.toString(10), "0");

        // Check the remittance amount has been taken from the contract eth balance
        const contractEthBalance = toBN(await getBalance(remittance.address));
        assert.strictEqual(contractEthBalance.toString(10), "0");

        // Check the remittance amount has been sent to the funder eth balance
        const funderEthBalance = toBN(await getBalance(funder));
        const cost = await getGasCost(txObj);
        const expectedFunderEthBalance = initFunderEthBalance.add(toBN(2)).sub(cost).toString(10);
        assert.strictEqual(funderEthBalance.toString(10), expectedFunderEthBalance);

    });

    it("Password cannot be reused to release in a second contract using the same creation hash", async () => {

        // Creating by reusing the original contract's hash seeded with the original password and first contract's address.
        // Releasing with the original password is unsuccessful
        let expiryDate = futureTimeStamp();
        const remittance2 = await Remittance.new({from: funder})
        await remittance2.create(hash, broker, expiryDate, {from: funder, value: 2});

        await truffleAssert.reverts(
            remittance2.release(passwordBytes32, {from: broker}),
            noFundsAvailableMsg
        );

        const result = await truffleAssert.createTransactionResult(remittance2, remittance2.transactionHash);
        await truffleAssert.eventNotEmitted(
            result
        );

        // Creating by using a new hash seeded with original password and the new contract's address.
        // Releasing with the original password is successful.
        // However this cannot be deduced from the transactions of the first contract.
        expiryDate = futureTimeStamp();
        const hash2 = await soliditySha3(passwordBytes32, broker, remittance2.address);
        await remittance2.create(hash2, broker, expiryDate, {from: funder, value: 2});
        txObj = await remittance2.release(passwordBytes32, {from: broker})

        truffleAssert.eventEmitted(txObj, 'RemittanceFundsReleased');
    });


    it("Call public password hash and broker rehashing function", async () => {
        const reHashedPassword = await remittance.hashPasswordBroker(passwordBytes32, broker);

        assert.strictEqual(reHashedPassword, hash);
    });

    it("Calling the public hashing function on a second contract provides different hashes with the same password", async () => {
        const originalHash = await remittance.hashPasswordBroker(passwordBytes32, broker);

        const remittance2 = await Remittance.new({from: funder})

        const expectedSecondHash = await soliditySha3(passwordBytes32, broker, remittance2.address);
        const secondHash = await remittance2.hashPasswordBroker(passwordBytes32, broker);
        assert.strictEqual(secondHash, expectedSecondHash);

        assert.notStrictEqual(originalHash, secondHash);
    });


    it("Creating a remittance reverts using a zero length bytes32 or hash value", async () => {

        let expiryDate = futureTimeStamp();

        await truffleAssert.reverts(
            remittance.create(zeroPassBytes32, broker, expiryDate, {from: funder, value: 2}),
            emptyHashErrorMsg
        );
        checkEventNotEmitted();

        expiryDate = futureTimeStamp();

        await truffleAssert.reverts(
            remittance.create(emptySha3Hash, broker, expiryDate, {from: funder, value: 2}),
            emptyHashErrorMsg
        );
        checkEventNotEmitted();
    });

    it("Creating a remittance reverts if the caller is the same as the broker", async () => {

        const expiryDate = futureTimeStamp();

        await truffleAssert.reverts(
            remittance.create(hash, funder, expiryDate, {from: funder, value: 2}),
            "Caller cannot be the broker"
        );
        checkEventNotEmitted();
    });

    it("Creating a remittance reverts when a zero address is used", async () => {

        const expiryDate = futureTimeStamp();

        await truffleAssert.reverts(
            remittance.create(hash, zeroAddress, expiryDate, {from: funder, value: 2}),
            "Address cannot be zero"
        );
        checkEventNotEmitted();
    });

    it("Creating a remittance reverts if the deposit amount is zero", async () => {

        const expiryDate = futureTimeStamp();

        await truffleAssert.reverts(
            remittance.create(hash, broker, expiryDate, {from: funder, value: 0}),
            "Amount must be greater than 0"
        );
        checkEventNotEmitted();
    });

    it("Creating a remittance reverts if called twice with the same arguments", async () => {

        let expiryDate = futureTimeStamp();
        await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});

        expiryDate = futureTimeStamp();
        await truffleAssert.reverts(
            remittance.create(hash, broker, expiryDate, {from: funder, value: 2}),
            "Remittance already exists"
        );
        checkEventNotEmitted();
    });

    it("Releasing funds reverts when using a zero length password", async () => {

        const expiryDate = futureTimeStamp();
        await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});

        await truffleAssert.reverts(
            remittance.release(zeroPassBytes32, {from: broker}),
            emptyPasswordErrorMsg
        );
        checkEventNotEmitted();

    });

    it("Releasing funds reverts when hash is invalid", async () => {

        const expiryDate = futureTimeStamp();
        await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});

        await truffleAssert.reverts(
            remittance.release(wrongPassBytes32, {from: broker}),
            noFundsAvailableMsg
        );
        checkEventNotEmitted();
    });

    it("Releasing funds reverts when the funds are zero", async () => {

        const expiryDate = futureTimeStamp();
        await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});
        await remittance.release(passwordBytes32, {from: broker});

        // re-attempt
        await truffleAssert.reverts(
            remittance.release(passwordBytes32, {from: broker}),
            noFundsAvailableMsg
        );
        checkEventNotEmitted();
    });

    it("Releasing funds reverts when the remittance has expired", async () => {

        const expiryDate = futureTimeStamp();
        await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});
        await timeMachine.advanceTimeAndBlock(day24hourinSecs + 1);

        await truffleAssert.reverts(
            remittance.release(passwordBytes32, {from: broker}),
            "Remittance has expired"
        );
        checkEventNotEmitted();
    });

    it("Reclaiming funds reverts when using a zero length hash", async () => {

        const expiryDate = futureTimeStamp();
        await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});
        await timeMachine.advanceTimeAndBlock(day24hourinSecs);

        await truffleAssert.reverts(
            remittance.reclaim(emptySha3Hash, {from: funder}),
            emptyHashErrorMsg
        );
        checkEventNotEmitted();

    });

    it("Reclaiming funds reverts when hash is invalid", async () => {

        const expiryDate = futureTimeStamp();
        await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});
        await timeMachine.advanceTimeAndBlock(day24hourinSecs);

        await truffleAssert.reverts(
            remittance.reclaim(wrongPassBytes32, {from: funder}),
            noFundsAvailableMsg
        );
        checkEventNotEmitted();
    });

    it("Reclaiming funds reverts when the funds are zero", async () => {

        const expiryDate = futureTimeStamp();
        await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});
        await remittance.release(passwordBytes32, {from: broker});
        await timeMachine.advanceTimeAndBlock(day24hourinSecs);

        // re-attempt
        await truffleAssert.reverts(
            remittance.reclaim(hash, {from: funder}),
            noFundsAvailableMsg
        );
        checkEventNotEmitted();
    });

    it("Reclaiming funds reverts when expiryDate has not expired", async () => {

        const expiryDate = futureTimeStamp();
        await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});

        // re-attempt
        await truffleAssert.reverts(
            remittance.reclaim(hash, {from: funder}),
            "The remittance has not expired"
        );
        checkEventNotEmitted();
    });

    it("Calling hash function with a zero length password reverts", async () => {

        await truffleAssert.reverts(
            remittance.hashPasswordBroker(zeroPassBytes32, broker),
            emptyPasswordErrorMsg
        );
    });

    it("Calling hash function using a zero address reverts", async () => {
        await truffleAssert.reverts(
            remittance.hashPasswordBroker(passwordBytes32, zeroAddress),
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
        const txObj = await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});

        await truffleAssert.eventEmitted(txObj, 'RemittanceFundsCreated');
    });

    it("Release is pausable and unpausable", async () => {

       const expiryDate = futureTimeStamp();
       await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});
       await remittance.pause({from: funder});

        await truffleAssert.reverts(
            remittance.release(passwordBytes32, {from: broker}),
            "Pausable: paused"
        );
        checkEventNotEmitted();

        await remittance.unpause({from: funder});
        const txObj = await remittance.release(passwordBytes32, {from: broker});
        await truffleAssert.eventEmitted(txObj, 'RemittanceFundsReleased');
    });

    it("Reclaim is pausable and unpausable", async () => {

        const expiryDate = futureTimeStamp();
        await remittance.create(hash, broker, expiryDate, {from: funder, value: 2});
        await timeMachine.advanceTimeAndBlock(day24hourinSecs);
        await remittance.pause({from: funder});

        await truffleAssert.reverts(
            remittance.reclaim(hash, {from: funder}),
            "Pausable: paused"
        );
        checkEventNotEmitted();

        await remittance.unpause({from: funder});
        const txObj = await remittance.reclaim(hash, {from: funder});
        await truffleAssert.eventEmitted(txObj, 'RemittanceFundsReclaimed');
    });
});
