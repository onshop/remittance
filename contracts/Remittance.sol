//SPDX-License-Identifier: MIT
pragma solidity >= 0.6.0 < 0.7.0;

import "./access/Ownable.sol";
import "./utils/Pausable.sol";

import {SafeMath} from "./math/SafeMath.sol";

contract Remittance is Ownable, Pausable {

    using SafeMath for uint256;

    mapping(bytes32 => RemittanceInstance) public remittances;

    // The 'valid' element provides a flag for checking a bonafide hash key
    struct RemittanceInstance {
        address funder;
        address broker;
        uint256 fundsOwed;
        uint256 expiryDate;
        bool valid;
    }

    event RemittanceCreated(
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
    function create(bytes32 recipientPasswordHash, address broker, uint256 expiryDate)
    external
    payable
    whenNotPaused
    returns(bool success)
    {
        require(broker != msg.sender, "The caller cannot be the broker");
        require(msg.value > 0, "The amount must be greater than 0");

        bytes32 rehash = keccak256ReHash(recipientPasswordHash, broker);

        RemittanceInstance storage remittanceInstance = remittances[rehash];

        remittanceInstance.funder = msg.sender;
        remittanceInstance.broker = broker;
        remittanceInstance.fundsOwed = msg.value;
        remittanceInstance.expiryDate = expiryDate;
        remittanceInstance.valid = true;

        emit RemittanceCreated(rehash, msg.sender, broker, msg.value, expiryDate);

        return true;
    }

    // The broker sends the recipient's password to release the funds
    function release(bytes32 recipientPasswordHash) external whenNotPaused returns(bool success) {

        bytes32 rehash = keccak256ReHash(recipientPasswordHash, address(msg.sender));

        //Retrieve remittance
        RemittanceInstance storage remittanceInstance = remittances[rehash];

        uint256 fundsOwed = remittanceInstance.fundsOwed;

        require(remittanceInstance.valid, "No remittance found");
        require(fundsOwed > 0, "No funds available");

        require(block.timestamp < remittanceInstance.expiryDate, "The remittance has expired");

        // Indicate remittance has been collected
        remittanceInstance.fundsOwed = 0;
        remittanceInstance.expiryDate = 0;

        emit RemittanceFundsReleased(rehash, msg.sender, fundsOwed);

        (success, ) = msg.sender.call{value: fundsOwed}("");
        require(success, "Transfer failed");
    }

    // Funder can retrieve funds if not claimed by the expiry date
    function reclaim(bytes32 recipientPasswordHash, address broker) external whenNotPaused returns(bool success) {

        bytes32 rehash = keccak256ReHash(recipientPasswordHash, broker);

        //Retrieve remittance
        RemittanceInstance storage remittanceInstance = remittances[rehash];

        uint256 fundsOwed = remittanceInstance.fundsOwed;

        require(remittanceInstance.valid, "No remittance found");
        require(fundsOwed > 0, "No funds available");

        require(block.timestamp >= remittanceInstance.expiryDate, "The remittance has not expired");
        require(msg.sender == remittanceInstance.funder, "Only the funder can reclaim funds");

        // Indicate that it was the funder who retrieved the expired funds
        remittanceInstance.broker = msg.sender;
        remittanceInstance.fundsOwed = 0;

        emit RemittanceFundsReclaimed(rehash, msg.sender, fundsOwed);

        (success, ) = msg.sender.call{value: fundsOwed}("");
        require(success, "Transfer failed");
    }

    // Utility function
    function keccak256Hash(string memory hashStr) public pure returns(bytes32) {
        require(bytes(hashStr).length > 0, 'Non-empty string required');

        return keccak256(abi.encodePacked(hashStr));
    }

    function keccak256ReHash(bytes32 hash, address broker) internal pure returns(bytes32) {
        require(broker != address(0), "Address cannot be zero");
        require(hash != bytes32(0) && hash != keccak256(abi.encodePacked('')) && hash != keccak256(abi.encodePacked(uint(0))),
                "Hash cannot be empty");

        return keccak256(abi.encodePacked(hash, broker));
    }

    function pause() public onlyOwner {
        super._pause();
    }

    function unpause() public onlyOwner {
        super._unpause();
    }

}
