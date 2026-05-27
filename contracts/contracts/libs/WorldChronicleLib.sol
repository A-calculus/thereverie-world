// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {WorldStateLib} from "./WorldStateLib.sol";

library WorldChronicleLib {
    event ChronicleAdded(uint256 eventIndex, string description);

    function recordFromAgent(
        WorldStateLib.Storage storage state,
        string memory description,
        uint256 requestId
    ) internal returns (uint256 index) {
        index = WorldStateLib.pushEvent(state, "chronicle", description, requestId);
    }

    function emitChronicle(uint256 index, string memory description) internal {
        emit ChronicleAdded(index, description);
    }
}
