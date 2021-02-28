//SPDX-License-Identifier: MIT
pragma solidity >= 0.6.0 < 0.7.0;

import "./access/Ownable.sol";
import "./utils/Pausable.sol";

import {SafeMath} from "./math/SafeMath.sol";

contract Remittance is Ownable, Pausable {

    using SafeMath for uint256;

    mapping(address => uint) public balances;

    mapping(bytes32 => RemittanceInstance) public remittances;

    struct RemittanceInstance {
        address funder;
        address broker;
        uint256 fundsOwed;
        uint256 deadline;
    }

    event Deposit(
        address indexed depositor,
        uint256 amount
    );

    event RemittanceCreated(
        bytes32 indexed hash,
        address indexed funder,
        address indexed broker,
        uint256 amount,
        uint256 deadline
    );

    event RemittanceFundsReleased(
        bytes32 indexed hash,
        address indexed broker,
        uint256 amount
    );

    event WithDraw(
        address indexed withdrawer,
        uint256 amount
    );

    // Generic deposit function
    function deposit() external payable whenNotPaused {
        require(msg.value > 0, "The value must be greater than 0");
        balances[msg.sender] = balances[msg.sender].add(msg.value);

        emit Deposit(msg.sender, msg.value);
    }

    // The funder can create a remittance
    // Hash is a sha256 hash of the broker address + recipient password
    function create(bytes32 recipientPasswordHash, address broker, uint256 deadline)
    external
    payable
    whenNotPaused
    returns(bool success)
    {
        checkIfHashIsEmpty(recipientPasswordHash);
        require(broker != msg.sender, "The caller cannot be the broker");
        require(msg.value > 0, "The amount must be greater than 0");

        bytes32 rehash = keccak256(abi.encodePacked(recipientPasswordHash, msg.sender));

        RemittanceInstance storage remittanceInstance = remittances[rehash];

        remittanceInstance.funder = msg.sender;
        remittanceInstance.broker = broker;
        remittanceInstance.fundsOwed = msg.value;
        remittanceInstance.deadline = deadline;

        emit RemittanceCreated(recipientPasswordHash, msg.sender, broker, msg.value, deadline);

        return true;
    }

    // The broker sends the recipient's password to release the funds
    function release(bytes32 recipientPasswordHash) external whenNotPaused returns(bool success) {

        checkIfHashIsEmpty(recipientPasswordHash);
        bytes32 rehash = keccak256(abi.encodePacked(recipientPasswordHash, msg.sender));

        //Retrieve remittance
        RemittanceInstance storage remittanceInstance = remittances[rehash];

        if(now < remittanceInstance.deadline){
            require(msg.sender == remittanceInstance.broker, "Only the broker can release funds");
        } else {
            require(msg.sender == remittanceInstance.funder, "Deadline passed");
        }

        uint256 fundsOwed = remittanceInstance.fundsOwed;

        require(fundsOwed > 0, "No funds available");

        // Indicate that the funder retrieved the expired funds
        if(msg.sender == remittanceInstance.funder) {
            remittanceInstance.broker = msg.sender;
        }

        remittanceInstance.fundsOwed = 0;

        emit RemittanceFundsReleased(recipientPasswordHash, msg.sender, fundsOwed);

        (success, ) = msg.sender.call{value: fundsOwed}("");
        require(success, "Transfer failed");
    }

    // Generic withdraw function
    function withdraw(uint256 amount) external whenNotPaused returns(bool success) {

        uint256 withdrawerBalance = balances[msg.sender];
        require(amount > 0, "The value must be greater than 0");
        require(withdrawerBalance >= amount, "There are insufficient funds");

        balances[msg.sender] = withdrawerBalance.sub(amount);
        emit WithDraw(msg.sender, amount);

        (success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
    }

    function pause() public onlyOwner {
        super._pause();
    }

    function unpause() public onlyOwner {
        super._unpause();
    }

    // check hash is not based on a bytes32 or sha3 hashed empty string
    function checkIfHashIsEmpty(bytes32 hash) internal pure {
        require(hash != 0x00 && hash != 0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563, "Hash cannot be empty");
    }

    // Utility function
    function hash(bytes32 hashString) public pure returns(bytes32) {
        return keccak256(abi.encodePacked(hashString));
    }
}
