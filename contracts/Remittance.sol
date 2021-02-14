//SPDX-License-Identifier: MIT
pragma solidity >= 0.6.0 < 0.7.0;

import "./access/Ownable.sol";
import "./utils/Pausable.sol";

import {SafeMath} from "./math/SafeMath.sol";

contract Remittance is Ownable, Pausable {

    using SafeMath for uint;

    mapping(address => uint) public balances;

    mapping(bytes32 => RemittanceContract) public contracts;

    struct RemittanceContract {
        address funder;
        address broker;
        address recipient;
        uint amount;
        bool fundsReleased;
    }

    event Deposit(
        address indexed depositor,
        uint amount
    );

    event RemittanceContractCreated(
        bytes32 hash,
        address indexed funder,
        address indexed broker,
        address indexed recipient,
        uint amount
    );

    event RemittanceFundsReleased(
        bytes32 hash,
        address indexed broker,
        uint amount
    );

    event WithDraw(
        address indexed withdrawer,
        uint amount
    );

    // Generic deposit function
    function deposit() external payable whenNotPaused {
        require(msg.value > 0, "The value must be greater than 0");
        balances[msg.sender] = balances[msg.sender].add(msg.value);

        emit Deposit(msg.sender, msg.value);
    }

    // The funder can create a remittance contract
    function create(bytes32 hash, address broker, address recipient, uint256 amount)
        external
        whenNotPaused
        returns(bool success)
    {

        require(broker != recipient, "The broker is the same as the recipient");
        require(broker != msg.sender && recipient != msg.sender, "The caller cannot be the broker or recipient");
        require(amount > 0, "The amount must be greater than 0");

        uint256 funderBalance = balances[msg.sender];
        require(funderBalance >= amount, "There are insufficient funds in the funder's account to create this remittance contract");

        RemittanceContract storage remittanceContract = contracts[hash];

        remittanceContract.funder = msg.sender;
        remittanceContract.broker = broker;
        remittanceContract.recipient = recipient;
        remittanceContract.amount = amount;
        remittanceContract.fundsReleased = false;

        emit RemittanceContractCreated(hash, msg.sender, broker, recipient, amount);

        return true;
    }

    // The broker takes concatenates their password with the recipient's password to release the funds
    function release(string memory concatenatedPassword) public whenNotPaused returns(bool) {

        require(bytes(concatenatedPassword).length > 0, "The concatenated password cannot be empty");
        bytes32 hash = keccak256(abi.encodePacked(concatenatedPassword));

        //Retrieve remittance contract
        RemittanceContract storage remittanceContract = contracts[hash];
        uint amount = remittanceContract.amount;
        address funder = remittanceContract.funder;
        address broker = remittanceContract.broker;

        require(msg.sender == broker, "Only the broker can release funds for this remittance");

        uint256 funderBalance = balances[funder];
        uint256 brokerBalance = balances[broker];

        // Subtract from Funder balance
        require(funderBalance >= amount, "There are insufficient funds available in the funder's contract balance");
        balances[funder] = SafeMath.sub(funderBalance, amount);

        // Add to Broker balance
        balances[broker] = brokerBalance.add(amount);

        remittanceContract.fundsReleased = true;

        emit RemittanceFundsReleased(hash, msg.sender, amount);

        return true;
    }

    // Generic withdraw function
    function withdraw(uint amount) public whenNotPaused returns(bool success) {

        uint256 withdrawerBalance = balances[msg.sender];
        require(amount > 0, "The value must be greater than 0");
        require(withdrawerBalance >= amount, "There are insufficient funds");

        balances[msg.sender] = SafeMath.sub(withdrawerBalance, amount);
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