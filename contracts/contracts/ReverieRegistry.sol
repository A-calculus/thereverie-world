// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./ReverieWorldInstance.sol";
import {WorldTypes} from "./libs/WorldTypes.sol";

/**
 * @title ReverieRegistry
 * @dev Factory for REVERIE autonomous worlds (Somnia testnet).
 */
contract ReverieRegistry is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    uint256 public registrationFee = 0;
    address public treasury;
    WorldTypes.WorldConfig public worldConfig;
    address public worldImplementation;

    struct WorldRecord {
        address worldAddress;
        string name;
        string template;
    }

    mapping(address => WorldRecord[]) public ownerToWorlds;
    WorldRecord[] public allWorlds;

    event WorldRegistered(address indexed owner, address indexed worldAddress, string name, string template);
    event WorldImplementationUpdated(address indexed implementation);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _treasury,
        WorldTypes.WorldConfig memory _worldConfig,
        address _worldImplementation,
        address initialOwner
    ) external initializer {
        __Ownable_init(initialOwner);
        __UUPSUpgradeable_init();
        require(_worldImplementation.code.length > 0, "Invalid world implementation");
        treasury = _treasury;
        worldConfig = _worldConfig;
        worldImplementation = _worldImplementation;
        emit WorldImplementationUpdated(_worldImplementation);
    }

    function deployWorld(string calldata name, string calldata template) external payable returns (address) {
        require(msg.value >= registrationFee, "Insufficient registration fee");

        if (registrationFee > 0) {
            payable(treasury).transfer(registrationFee);
        }

        bytes memory initData = abi.encodeCall(
            ReverieWorldInstance.initialize,
            (msg.sender, worldConfig)
        );
        ERC1967Proxy newWorld = new ERC1967Proxy(worldImplementation, initData);

        WorldRecord memory record = WorldRecord(address(newWorld), name, template);
        ownerToWorlds[msg.sender].push(record);
        allWorlds.push(record);

        emit WorldRegistered(msg.sender, address(newWorld), name, template);

        if (msg.value > registrationFee) {
            payable(msg.sender).transfer(msg.value - registrationFee);
        }

        return address(newWorld);
    }

    function getWorldsByOwner(address owner) external view returns (WorldRecord[] memory) {
        return ownerToWorlds[owner];
    }

    function getAllWorlds() external view returns (WorldRecord[] memory) {
        return allWorlds;
    }

    function setRegistrationFee(uint256 newFee) external {
        require(msg.sender == owner(), "Only owner");
        registrationFee = newFee;
    }

    function setWorldConfig(WorldTypes.WorldConfig calldata _worldConfig) external {
        require(msg.sender == owner(), "Only owner");
        worldConfig = _worldConfig;
    }

    function setWorldImplementation(address _worldImplementation) external onlyOwner {
        require(_worldImplementation.code.length > 0, "Invalid world implementation");
        worldImplementation = _worldImplementation;
        emit WorldImplementationUpdated(_worldImplementation);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
