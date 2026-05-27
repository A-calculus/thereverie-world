// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title CallbackReceiver
 * @notice Receiver for Somnia Agent results (testnet).
 *         Deployed once per platform. SDK filters AgentResult by requestId and can
 *         fall back to stored results if a WebSocket event is missed.
 */
contract CallbackReceiver is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    address public PLATFORM;

    struct Response {
        address validator;
        bytes result;
        uint8 status;
        uint256 receipt;
        uint256 timestamp;
        uint256 executionCost;
    }

    struct StoredResult {
        bytes result;
        uint8 status;
        bool success;
        bool exists;
    }

    uint256 public latestRequestId;
    bytes public latestResult;
    uint8 public latestStatus;

    mapping(uint256 => StoredResult) public results;

    event AgentResult(
        uint256 indexed requestId,
        bytes result,
        bool success,
        uint8 status
    );

    error UnauthorizedCaller(address caller);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address platform, address initialOwner) external initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
        PLATFORM = platform;
    }

    function receiveCallback(uint256 requestId, Response[] calldata responses, uint8 status) external {
        if (msg.sender != PLATFORM) revert UnauthorizedCaller(msg.sender);

        bytes memory result = bytes("");
        bool success = (status == 2);

        for (uint256 i = 0; i < responses.length; i++) {
            if (responses[i].status == 2 && responses[i].result.length > 0) {
                result = responses[i].result;
                success = true;
                break;
            }
        }

        if (result.length == 0 && responses.length > 0) {
            result = responses[0].result;
        }

        latestRequestId = requestId;
        latestResult = result;
        latestStatus = status;
        results[requestId] = StoredResult({
            result: result,
            status: status,
            success: success,
            exists: true
        });

        emit AgentResult(requestId, result, success, status);
    }

    function hasResult(uint256 requestId) external view returns (bool) {
        return results[requestId].exists;
    }

    receive() external payable {}

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
