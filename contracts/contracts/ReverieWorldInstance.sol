// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./interfaces/ISomniaAgents.sol";
import {WorldTypes} from "./libs/WorldTypes.sol";
import {WorldStateLib} from "./libs/WorldStateLib.sol";
import {WorldAgentLib} from "./libs/WorldAgentLib.sol";
import {WorldDataOracleLib} from "./libs/WorldDataOracleLib.sol";
import {WorldChronicleLib} from "./libs/WorldChronicleLib.sol";
import {SomniaNativeAgentsLib} from "./libs/SomniaNativeAgentsLib.sol";
import {ReactivityLib} from "./libs/ReactivityLib.sol";

/**
 * @title ReverieWorldInstance
 * @dev Facade for a single REVERIE autonomous world (Somnia testnet).
 */
contract ReverieWorldInstance is Initializable, OwnableUpgradeable, UUPSUpgradeable, SomniaEventHandler {
    WorldTypes.WorldConfig public config;

    WorldStateLib.Storage private _state;
    WorldAgentLib.Storage private _agent;
    WorldDataOracleLib.Storage private _oracle;

    mapping(uint256 => uint256) public reactivitySubscriptions;
    mapping(bytes32 => address) private _modules;
    mapping(address => uint256) private _moduleInstallCounts;

    error Unauthorized();
    error PlatformOnly();
    error ModuleNotInstalled(bytes32 moduleId);
    error InvalidModule();
    error ModuleExecutionFailed(bytes data);

    event TriggerFired(bytes32 indexed triggerId, string context);
    event ReactivitySubscribed(uint256 indexed subscriptionId, bytes32 eventSig);
    event ModuleInstalled(bytes32 indexed moduleId, address indexed module);
    event ModuleRemoved(bytes32 indexed moduleId, address indexed module);
    event ModuleExecuted(bytes32 indexed moduleId, address indexed module, bytes result);

    modifier onlyOwnerOrModule() {
        if (msg.sender != owner() && !_isInstalledModule(msg.sender)) revert Unauthorized();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _owner, WorldTypes.WorldConfig memory _config) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        config = _config;
    }

    receive() external payable {}

    // ─── Zone & faction state ────────────────────────────────────────────────

    function setZone(
        bytes32 zoneId,
        string calldata name,
        uint256 dangerLevel,
        string calldata faction
    ) external onlyOwner {
        WorldStateLib.setZone(_state, zoneId, name, dangerLevel, faction);
    }

    function zones(bytes32 zoneId)
        external
        view
        returns (string memory name, uint256 dangerLevel, string memory controllingFaction, string memory climateState)
    {
        WorldTypes.Zone storage z = _state.zones[zoneId];
        return (z.name, z.dangerLevel, z.controllingFaction, z.climateState);
    }

    function eventHistory(uint256 index)
        external
        view
        returns (uint256 timestamp, string memory eventType, string memory description, uint256 requestId)
    {
        WorldTypes.WorldEvent storage e = _state.eventHistory[index];
        return (e.timestamp, e.eventType, e.description, e.requestId);
    }

    function triggerCooldowns(bytes32 triggerId) external view returns (uint256) {
        return _state.triggerCooldowns[triggerId];
    }

    function factionMorale(string calldata factionId)
        external
        view
        returns (int256 moraleDelta, string memory narrative, uint256 updatedAt)
    {
        WorldTypes.FactionMorale storage m = _state.factionMorale[factionId];
        return (m.moraleDelta, m.narrative, m.updatedAt);
    }

    function applyClimateResult(bytes32 zoneId, string calldata climateState) external onlyOwnerOrModule {
        WorldStateLib.applyClimateResult(_state, zoneId, climateState);
    }

    function applyConflictOutcome(bytes32 zoneId, string calldata outcome) external onlyOwnerOrModule {
        WorldStateLib.applyConflictOutcome(_state, zoneId, outcome);
    }

    function updateFactionMorale(
        string calldata factionId,
        int256 moraleDelta,
        string calldata narrative
    ) external onlyOwnerOrModule {
        WorldStateLib.updateFactionMorale(_state, factionId, moraleDelta, narrative);
    }

    // ─── Owner-installed feature modules ────────────────────────────────────

    function installModule(bytes32 moduleId, address module) external onlyOwner {
        if (moduleId == bytes32(0) || module == address(0) || module.code.length == 0) {
            revert InvalidModule();
        }
        address previous = _modules[moduleId];
        if (previous != address(0)) {
            _moduleInstallCounts[previous] -= 1;
        }
        _modules[moduleId] = module;
        _moduleInstallCounts[module] += 1;
        emit ModuleInstalled(moduleId, module);
    }

    function removeModule(bytes32 moduleId) external onlyOwner {
        address module = _modules[moduleId];
        if (module == address(0)) revert ModuleNotInstalled(moduleId);
        delete _modules[moduleId];
        _moduleInstallCounts[module] -= 1;
        emit ModuleRemoved(moduleId, module);
    }

    function getModule(bytes32 moduleId) external view returns (address) {
        return _modules[moduleId];
    }

    function executeModule(bytes32 moduleId, bytes calldata data)
        external
        payable
        onlyOwner
        returns (bytes memory result)
    {
        address module = _modules[moduleId];
        if (module == address(0)) revert ModuleNotInstalled(moduleId);

        (bool ok, bytes memory ret) = module.call{value: msg.value}(data);
        if (!ok) revert ModuleExecutionFailed(ret);
        emit ModuleExecuted(moduleId, module, ret);
        return ret;
    }

    // ─── Native agent requests (returns requestId for WSS tracking) ─────────

    function requestLlm(
        bytes32 triggerId,
        string calldata prompt,
        string calldata system,
        string[] calldata allowedValues,
        uint256 cooldownSeconds
    ) external payable returns (uint256 requestId) {
        requestId = WorldAgentLib.requestAgentDecision(
            _agent,
            _state,
            config,
            triggerId,
            prompt,
            system,
            allowedValues,
            cooldownSeconds,
            this.handleAgentResponse.selector
        );
        emit TriggerFired(triggerId, prompt);
    }

    function requestAgentDecision(
        bytes32 triggerId,
        string calldata prompt,
        string calldata system,
        string[] calldata allowedValues,
        uint256 cooldownSeconds
    ) external payable returns (uint256 requestId) {
        requestId = WorldAgentLib.requestAgentDecision(
            _agent,
            _state,
            config,
            triggerId,
            prompt,
            system,
            allowedValues,
            cooldownSeconds,
            this.handleAgentResponse.selector
        );
        emit TriggerFired(triggerId, prompt);
    }

    function requestJsonApi(
        bytes32 triggerId,
        string calldata url,
        string calldata selector,
        uint256 cooldownSeconds
    ) external payable returns (uint256 requestId) {
        requestId = WorldDataOracleLib.requestJsonOracle(
            _oracle,
            _state,
            config,
            triggerId,
            url,
            selector,
            cooldownSeconds,
            this.handleJsonOracleResponse.selector
        );
        emit TriggerFired(triggerId, url);
    }

    function requestJsonOracle(
        bytes32 triggerId,
        string calldata url,
        string calldata selector,
        uint256 cooldownSeconds
    ) external payable returns (uint256 requestId) {
        requestId = WorldDataOracleLib.requestJsonOracle(
            _oracle,
            _state,
            config,
            triggerId,
            url,
            selector,
            cooldownSeconds,
            this.handleJsonOracleResponse.selector
        );
        emit TriggerFired(triggerId, url);
    }

    function requestWebParse(
        bytes32 triggerId,
        bytes calldata payload,
        uint256 cooldownSeconds
    ) external payable returns (uint256 requestId) {
        requestId = WorldDataOracleLib.requestWebParse(
            _oracle,
            _state,
            config,
            triggerId,
            payload,
            cooldownSeconds,
            this.handleJsonOracleResponse.selector
        );
        emit TriggerFired(triggerId, "web_parse");
    }

    function recordChronicleEntry(string calldata description) external onlyOwnerOrModule {
        WorldChronicleLib.recordFromAgent(_state, description, 0);
    }

    function chronicleFromAgent(
        bytes32 triggerId,
        string calldata rawEvent,
        string calldata system,
        uint256 cooldownSeconds
    ) external payable onlyOwner returns (uint256 requestId) {
        requestId = WorldAgentLib.requestAgentDecision(
            _agent,
            _state,
            config,
            triggerId,
            rawEvent,
            system,
            new string[](0),
            cooldownSeconds,
            this.handleAgentResponse.selector
        );
        WorldAgentLib.markChroniclePending(_agent, requestId);
    }

    // ─── Reactivity (on-chain autonomous triggers) ───────────────────────────

    function subscribeToEvent(
        address emitter,
        bytes32 eventSig,
        uint64 gasLimit
    ) external onlyOwner returns (uint256 subscriptionId) {
        subscriptionId = ReactivityLib.subscribeToEmitter(
            address(this),
            emitter,
            eventSig,
            gasLimit
        );
        reactivitySubscriptions[subscriptionId] = subscriptionId;
        emit ReactivitySubscribed(subscriptionId, eventSig);
    }

    function unsubscribeFromEvent(uint256 subscriptionId) external onlyOwner {
        ReactivityLib.unsubscribe(subscriptionId);
        delete reactivitySubscriptions[subscriptionId];
    }

    // ─── Platform callbacks ──────────────────────────────────────────────────

    function handleAgentResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external {
        if (msg.sender != config.llmPlatform) revert PlatformOnly();
        WorldAgentLib.handleAgentResponse(_agent, _state, requestId, responses, status);
    }

    function handleJsonOracleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external {
        if (msg.sender != config.jsonPlatform) revert PlatformOnly();
        WorldDataOracleLib.handleJsonResponse(_oracle, _state, requestId, responses, status);
    }

    function _onEvent(
        address emitter,
        bytes32[] calldata eventTopics,
        bytes calldata data
    ) internal override {
        if (eventTopics.length == 0) return;
        // AgentDecisionReceived — could chain further native calls (MVP: emit only)
        if (emitter == address(this)) {
            emit TriggerFired(eventTopics[0], "reactivity_callback");
        }
        (emitter, data);
    }

    function withdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    function _isInstalledModule(address module) internal view returns (bool) {
        return _moduleInstallCounts[module] > 0;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
