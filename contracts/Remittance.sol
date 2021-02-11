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

    event WithDraw(
        address indexed broker,
        bytes32 hash,
        uint amount
    );

    function checkStringIsNotEmpty (string memory str) internal pure {
        require(
            bytes(str).length > 0,
            "The hash cannot be empty"
        );
    }

    function deposit() external payable whenNotPaused {
        require(msg.value > 0, "The value must be greater than 0");
        balances[msg.sender] = balances[msg.sender].add(msg.value);

        emit Deposit(msg.sender, msg.value);
    }

    function create(bytes32 hash, address broker, address recipient, uint256 amount) external whenNotPaused returns(bool success) {
        require(hash.length > 0, "The hash cannot be empty");
        uint256 funderBalance = balances[msg.sender];
        require(funderBalance >= amount, "There are insufficient funds in the sender's account to create this contract");

        require(broker == address(broker) && broker != address(0), "Invalid broker address");
        require(recipient == address(recipient) && recipient != address(0), "Invalid recipient address");
        require(broker != recipient, "The broker and recipient addresses must be different");
        require(amount > 0, "The amount must be greater than 0");
        require(hash.length > 0, "The hash cannot be empty");

        balances[msg.sender] = funderBalance.sub(amount);
        balances[broker] =  balances[broker].add(amount);

        RemittanceContract storage remittanceContract = contracts[hash];

        remittanceContract.funder = msg.sender;
        remittanceContract.broker = broker;
        remittanceContract.recipient = recipient;
        remittanceContract.amount = amount;
        remittanceContract.fundsReleased = false;

        emit RemittanceContractCreated(hash, msg.sender, broker, recipient, amount);

        return success;
    }


    function withdraw(string memory concatenatedPassword) public whenNotPaused returns(bool success) {
        require(bytes(concatenatedPassword).length > 0, "The concatenated password cannot be empty");
        bytes32 hash = keccak256(abi.encodePacked(concatenatedPassword));

        RemittanceContract storage remittanceContract = contracts[hash];

        uint amount = remittanceContract.amount;
        address funder = remittanceContract.funder;

        uint256 withdrawerBalance = balances[msg.sender];
        require(withdrawerBalance >= amount, "There are insufficient funds available in the withdrawer's contract balance");

        uint256 funderBalance = balances[funder];
        require(funderBalance >= amount, "There are insufficient funds available in the funder's contract balance");

        balances[msg.sender] = SafeMath.sub(withdrawerBalance, amount);
        remittanceContract.fundsReleased = true;

        emit WithDraw(msg.sender, hash, amount);

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