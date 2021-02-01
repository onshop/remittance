//SPDX-License-Identifier: MIT
pragma solidity >= 0.6.0 < 0.7.0;

import "../node_modules/@openzeppelin/contracts/access/Ownable.sol";
import "../node_modules/@openzeppelin/contracts/utils/Pausable.sol";

import {SafeMath} from "../node_modules/@openzeppelin/contracts/math/SafeMath.sol";

contract Remittance is Ownable, Pausable {

    using SafeMath for uint;



    function pause() public onlyOwner {
        super._pause();
    }

    function unpause() public onlyOwner {
        super._unpause();
    }
}