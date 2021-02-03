//SPDX-License-Identifier: MIT
pragma solidity >= 0.6.0 < 0.7.0;

import "./access/Ownable.sol";
import "./utils/Pausable.sol";

import {SafeMath} from "./math/SafeMath.sol";

contract Remittance is Ownable, Pausable {

    using SafeMath for uint;

    mapping(address => uint) public balances;

    mapping(bytes32 => RemittanceContract) public remittanceContracts;

    struct RemittanceContract {
        address sender;
        address broker;
        uint amount;
        bool fundsReleased;
    }

    event Deposit(
        address indexed depositor,
        uint amount
    );

    event RemittanceContractCreated(
        address indexed sender,
        address indexed broker,
        bytes32 hash,
        uint amount
    );

    event WithDraw(
        address indexed withdrawer,
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

    function create(address broker, bytes32 hash, uint256 amount) external whenNotPaused returns(bool success) {

        uint256 withdrawerBalance = balances[msg.sender];
        require(withdrawerBalance >= amount, "There are insufficient funds in the sender's account to create this contract");

        require(broker == address(broker) && broker != address(0));
        require(amount > 0, "The value must be greater than 0");
        require(hash.length > 0, "The hash cannot be empty");

        RemittanceContract storage remittanceContract = remittanceContracts[hash];

        remittanceContract.broker = broker;
        remittanceContract.amount = amount;
        remittanceContract.fundsReleased = false;

        emit RemittanceContractCreated(msg.sender, broker, hash, amount);

        return success;
    }


    function withdraw(string memory concatenatedPassword) public whenNotPaused returns(bool success) {

        bytes32 hash = keccak256(abi.encodePacked(concatenatedPassword));

        RemittanceContract storage remittanceContract = remittanceContracts[hash];

        uint amount = remittanceContract.amount;
        address sender = remittanceContract.sender;

        uint256 withdrawerBalance = balances[sender];
        require(withdrawerBalance >= amount, "There are insufficient funds available in the sender's account");

        balances[sender] = SafeMath.sub(withdrawerBalance, amount);
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