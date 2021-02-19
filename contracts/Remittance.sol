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
    }

    event Deposit(
        address indexed depositor,
        uint256 amount
    );

    event RemittanceCreated(
        bytes32 indexed hash,
        address indexed funder,
        address indexed broker,
        uint256 amount
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
    function create(bytes32 hash, address broker, uint256 amount)
        external
        whenNotPaused
        returns(bool success)
    {
        require(broker != msg.sender, "The caller cannot be the broker");
        require(amount > 0, "The amount must be greater than 0");

        uint256 funderBalance = balances[msg.sender];

        // Subtract from Funder balance
        balances[msg.sender] = funderBalance.sub(amount);

        RemittanceInstance storage remittanceInstance = remittances[hash];

        remittanceInstance.funder = msg.sender;
        remittanceInstance.broker = broker;
        remittanceInstance.fundsOwed = amount;

        emit RemittanceCreated(hash, msg.sender, broker, amount);

        return true;
    }

    // The broker takes concatenates their password with the recipient's password to release the funds
    function release(string memory concatenatedPassword) public whenNotPaused returns(bool success) {

        require(bytes(concatenatedPassword).length > 0, "Password cannot be empty");
        bytes32 hash = keccak256(abi.encodePacked(concatenatedPassword));

        //Retrieve remittance
        RemittanceInstance storage remittanceInstance = remittances[hash];

        require(msg.sender == remittanceInstance.broker, "Only the broker can release funds");
        require(remittanceInstance.fundsOwed > 0, "The funds have already been released");

        emit RemittanceFundsReleased(hash, msg.sender, remittanceInstance.fundsOwed);
        remittanceInstance.fundsOwed = 0;

        (success, ) = msg.sender.call{value: remittanceInstance.fundsOwed}("");
        require(success, "Transfer failed");
    }

    // Generic withdraw function
    function withdraw(uint256 amount) public whenNotPaused returns(bool success) {

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
}