//SPDX-License-Identifier: MIT
pragma solidity >= 0.6.0 < 0.7.0;

import "./access/Ownable.sol";
import "./utils/Pausable.sol";

import {SafeMath} from "./math/SafeMath.sol";

contract Remittance is Ownable, Pausable {

    using SafeMath for uint256;

    mapping(bytes32 => RemittanceInstance) public remittances;

    struct RemittanceInstance {
        address funder;
        uint256 fundsOwed;
        uint256 expiryDate;
    }

    event RemittanceFundsCreated(
        bytes32 indexed hash,
        address indexed funder,
        address indexed broker,
        uint256 amount,
        uint256 expiryDate
    );

    event RemittanceFundsReleased(
        bytes32 indexed hash,
        address indexed broker,
        uint256 amount
    );

    event RemittanceFundsReclaimed(
        bytes32 indexed hash,
        address indexed funder,
        uint256 amount
    );

    // The funder can create a remittance
    // Hash is a sha256 hash of the broker address + recipient password
    function create(bytes32 passwordBrokerHash, address broker, uint256 expiryDate)
    external
    payable
    whenNotPaused
    returns(bool success)
    {
        require(broker != msg.sender, "Caller cannot be the broker");
        require(msg.value > 0, "Amount must be greater than 0");
        require(broker != address(0), "Address cannot be zero");
        // Block timestamp can be as much as 627 seconds behind UI
        require(expiryDate >= block.timestamp + (24 * 60 * 60) - 700, "Expiry less than 24h ahead");
        checkEmptyHash(passwordBrokerHash);

        RemittanceInstance storage remittanceInstance = remittances[passwordBrokerHash];

        // .funder must be empty otherwise the key is already in use
        require(remittanceInstance.funder == address(0), "Remittance already exists");

        remittanceInstance.funder = msg.sender;
        remittanceInstance.fundsOwed = msg.value;
        remittanceInstance.expiryDate = expiryDate;

        emit RemittanceFundsCreated(passwordBrokerHash, msg.sender, broker, msg.value, expiryDate);

        return true;
    }

    // The broker sends the recipient's password to release the funds
    function release(bytes32 password) external whenNotPaused returns(bool success) {

        bytes32 passwordBrokerHash = hashPasswordBroker(password, address(msg.sender));

        //Retrieve remittance
        RemittanceInstance storage remittanceInstance = remittances[passwordBrokerHash];

        uint256 fundsOwed = remittanceInstance.fundsOwed;

        require(fundsOwed > 0, "No funds available");
        require(block.timestamp < remittanceInstance.expiryDate, "Remittance has expired");

        // Indicate remittance has been collected
        remittanceInstance.fundsOwed = 0;
        remittanceInstance.expiryDate = 0;

        emit RemittanceFundsReleased(passwordBrokerHash, msg.sender, fundsOwed);

        (success, ) = msg.sender.call{value: fundsOwed}("");
        require(success, "Transfer failed");
    }

    // Funder can retrieve funds if not claimed by the expiry date
    function reclaim(bytes32 passwordBrokerHash) external whenNotPaused returns(bool success) {

        checkEmptyHash(passwordBrokerHash);

        //Retrieve remittance
        RemittanceInstance storage remittanceInstance = remittances[passwordBrokerHash];

        uint256 fundsOwed = remittanceInstance.fundsOwed;

        require(fundsOwed > 0, "No funds available");
        require(block.timestamp >= remittanceInstance.expiryDate, "The remittance has not expired");
        require(msg.sender == remittanceInstance.funder, "Only the funder can reclaim funds");

        // Indicate that it was the funder who retrieved the expired funds
        remittanceInstance.fundsOwed = 0;
        remittanceInstance.expiryDate = 0;

        emit RemittanceFundsReclaimed(passwordBrokerHash, msg.sender, fundsOwed);

        (success, ) = msg.sender.call{value: fundsOwed}("");
        require(success, "Transfer failed");
    }

    // Utility function
    function hashPasswordBroker(bytes32 password, address broker) public pure returns(bytes32) {
        require(password != bytes32(0), "Password cannot be empty");
        require(broker != address(0), "Address cannot be zero");

        return keccak256(abi.encodePacked(password, broker));
    }

    function checkEmptyHash(bytes32 hash) internal pure returns(bool) {
        require(hash != bytes32(0) && hash != keccak256(abi.encodePacked('')) && hash != keccak256(abi.encodePacked(uint(0))),
            "Hash cannot be empty");
        return true;
    }

    function pause() public onlyOwner {
        super._pause();
    }

    function unpause() public onlyOwner {
        super._unpause();
    }

}
