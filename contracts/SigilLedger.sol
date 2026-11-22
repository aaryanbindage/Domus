// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Sigil ledger — the national currency of an online nation, on-chain.
/// @notice Sigils are numbered collectibles whose rarity (and so face value) is fixed by
/// their serial. They can only ever be held by registered citizens, the Treasury reserve
/// or marketplace escrow: there is no approve(), no ERC-20/721 interface and no way to
/// send a Sigil to an ordinary address, so exchanges and NFT marketplaces cannot hold or
/// trade them. Citizens authorise payments with EIP-712 signatures from the key in their
/// .access file; the Treasury relays them and pays the gas, so citizens need no wallet
/// software and no ETH.
contract SigilLedger {
    uint32 public constant TREASURY = type(uint32).max;
    uint32 public constant ESCROW = type(uint32).max - 1;

    struct Citizen { address signer; bool active; bool granted; }
    struct Transfer { uint32 from; uint32 to; uint256 amount; bytes32 serialsHash; bytes32 ref; uint256 nonce; uint256 deadline; }
    struct Exchange { uint32 from; uint32 serial; uint256 nonce; uint256 deadline; }
    struct Break { uint32 serial; uint32[] change; uint32 mintCommons; }

    bytes32 private constant TRANSFER_TYPEHASH = keccak256("Transfer(uint32 from,uint32 to,uint256 amount,bytes32 serialsHash,bytes32 ref,uint256 nonce,uint256 deadline)");
    bytes32 private constant EXCHANGE_TYPEHASH = keccak256("Exchange(uint32 from,uint32 serial,uint256 nonce,uint256 deadline)");
    uint256 private constant HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    bytes32 public immutable DOMAIN_SEPARATOR;
    uint32 public immutable GRANT;
    // Rarity of serial s: x = first 4 bytes of sha256("sigil:" + s); legendary if x < t0, epic if x < t1, …
    uint64 private immutable T0; uint64 private immutable T1; uint64 private immutable T2; uint64 private immutable T3;
    // Face values by rarity index: 0 common, 1 uncommon, 2 rare, 3 epic, 4 legendary.
    uint256 private immutable V0; uint256 private immutable V1; uint256 private immutable V2; uint256 private immutable V3; uint256 private immutable V4;

    address public registrar;
    uint32 public nextSerial = 1;
    mapping(uint32 => Citizen) public citizens;
    mapping(uint32 => uint256) public nonces;
    mapping(uint32 => uint256) public balanceOf; // SGL face value held
    mapping(uint32 => uint256) public countOf;   // number of Sigils held
    mapping(uint256 => uint256) private _owners;  // 8 packed uint32 owner ids per word
    mapping(uint256 => uint256) private _changeMint; // bitmap: Mint-change Sigils are always common

    event CitizenRegistered(uint32 indexed id, address signer);
    event SignerChanged(uint32 indexed id, address signer);
    event StatusChanged(uint32 indexed id, bool active);
    event RegistrarChanged(address registrar);
    event Minted(uint32 indexed to, uint32 firstSerial, uint32 count, uint256 value, bool change);
    event Moved(uint32 indexed from, uint32 indexed to, uint32[] serials, uint256 value, bytes32 ref);

    error NotRegistrar();
    error NotCitizen(uint32 id);
    error BadSignature();
    error Expired();
    error BadNonce();
    error NotOwner(uint32 serial, uint32 owner);
    error ValueMismatch(uint256 expected, uint256 actual);
    error NotAllowed();

    modifier onlyRegistrar() { if (msg.sender != registrar) revert NotRegistrar(); _; }

    constructor(string memory name, uint32 grantSize, uint64[4] memory thresholds, uint256[5] memory values) {
        registrar = msg.sender;
        GRANT = grantSize;
        (T0, T1, T2, T3) = (thresholds[0], thresholds[1], thresholds[2], thresholds[3]);
        (V0, V1, V2, V3, V4) = (values[0], values[1], values[2], values[3], values[4]);
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes(name)), keccak256("1"), block.chainid, address(this)));
    }

    // ------------------------------------------------------------------ citizens (Treasury)

    function register(uint32 id, address signer) external onlyRegistrar {
        if (id == 0 || id >= ESCROW || signer == address(0) || citizens[id].signer != address(0)) revert NotAllowed();
        citizens[id] = Citizen(signer, true, false);
        emit CitizenRegistered(id, signer);
    }

    /// Key reissue: Sigils belong to the citizen number, so only the signing key changes.
    function setSigner(uint32 id, address signer) external onlyRegistrar {
        if (citizens[id].signer == address(0) || signer == address(0)) revert NotCitizen(id);
        citizens[id].signer = signer;
        emit SignerChanged(id, signer);
    }

    function setActive(uint32 id, bool active) external onlyRegistrar {
        if (citizens[id].signer == address(0)) revert NotCitizen(id);
        citizens[id].active = active;
        emit StatusChanged(id, active);
    }

    function setRegistrar(address next) external onlyRegistrar {
        registrar = next;
        emit RegistrarChanged(next);
    }

    /// The citizenship grant: exactly GRANT new Sigils, once per citizen, ever.
    function grant(uint32 to) external onlyRegistrar returns (uint32 first) {
        Citizen storage c = citizens[to];
        if (!c.active || c.granted) revert NotAllowed();
        c.granted = true;
        return _mint(to, GRANT, false);
    }

    // ------------------------------------------------------------------ payments (citizen-signed)

    function transfer(Transfer calldata t, bytes calldata sig, uint32[] calldata serials, Break[] calldata breaks) external {
        Citizen storage c = _authorise(t.from, t.nonce, t.deadline, sig,
            keccak256(abi.encode(TRANSFER_TYPEHASH, t.from, t.to, t.amount, t.serialsHash, t.ref, t.nonce, t.deadline)));
        if (t.to == t.from || (t.to != ESCROW && !citizens[t.to].active)) revert NotCitizen(t.to);
        if (t.serialsHash != bytes32(0)) {
            // The citizen chose these exact Sigils.
            if (breaks.length != 0 || keccak256(abi.encode(serials)) != t.serialsHash) revert NotAllowed();
        } else if (msg.sender != registrar && msg.sender != c.signer) {
            revert NotAllowed(); // only the Treasury (or the citizen) may choose which Sigils pay
        }
        for (uint256 i; i < breaks.length; i++) _break(t.from, breaks[i].serial, breaks[i].change, breaks[i].mintCommons, t.ref);
        uint256 v = _moveAll(serials, t.from, t.to, t.ref);
        if (v != t.amount) revert ValueMismatch(t.amount, v);
    }

    /// Break a Sigil into change of equal value at the Mint.
    function exchange(Exchange calldata e, bytes calldata sig, uint32[] calldata change, uint32 mintCommons) external {
        Citizen storage c = _authorise(e.from, e.nonce, e.deadline, sig,
            keccak256(abi.encode(EXCHANGE_TYPEHASH, e.from, e.serial, e.nonce, e.deadline)));
        if (msg.sender != registrar && msg.sender != c.signer) revert NotAllowed();
        _break(e.from, e.serial, change, mintCommons, bytes32(0));
    }

    /// Marketplace escrow is released to the seller or refunded to the buyer by the Treasury.
    function releaseEscrow(uint32 to, uint32[] calldata serials, bytes32 ref) external onlyRegistrar {
        if (citizens[to].signer == address(0)) revert NotCitizen(to);
        _moveAll(serials, ESCROW, to, ref);
    }

    // ------------------------------------------------------------------ views

    function ownerOf(uint32 serial) public view returns (uint32) {
        return uint32(_owners[serial >> 3] >> ((serial & 7) * 32));
    }

    function ownersOf(uint32 first, uint32 count) external view returns (uint32[] memory out) {
        out = new uint32[](count);
        for (uint32 i; i < count; i++) out[i] = ownerOf(first + i);
    }

    /// 0 common, 1 uncommon, 2 rare, 3 epic, 4 legendary
    function rarityOf(uint32 serial) public view returns (uint8) {
        if (serial == 0 || serial >= nextSerial) revert NotOwner(serial, 0);
        if ((_changeMint[serial >> 8] >> (serial & 255)) & 1 == 1) return 0;
        uint64 x = uint64(uint32(bytes4(sha256(abi.encodePacked("sigil:", _decimal(serial))))));
        if (x < T0) return 4;
        if (x < T1) return 3;
        if (x < T2) return 2;
        if (x < T3) return 1;
        return 0;
    }

    function valueOf(uint32 serial) public view returns (uint256) {
        uint8 r = rarityOf(serial);
        return r == 0 ? V0 : r == 1 ? V1 : r == 2 ? V2 : r == 3 ? V3 : V4;
    }

    // ------------------------------------------------------------------ internals

    function _authorise(uint32 from, uint256 nonce, uint256 deadline, bytes calldata sig, bytes32 structHash)
        private returns (Citizen storage c)
    {
        c = citizens[from];
        if (!c.active) revert NotCitizen(from);
        if (block.timestamp > deadline) revert Expired();
        if (nonce != nonces[from]) revert BadNonce();
        nonces[from] = nonce + 1;
        if (_recover(keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)), sig) != c.signer) revert BadSignature();
    }

    function _break(uint32 from, uint32 serial, uint32[] calldata change, uint32 mintCommons, bytes32 ref) private {
        uint256 v = valueOf(serial);
        if (v <= V0) revert NotAllowed();
        uint32[] memory one = new uint32[](1);
        one[0] = serial;
        _moveAll(one, from, TREASURY, ref);
        uint256 got = uint256(mintCommons) * V0;
        for (uint256 i; i < change.length; i++) {
            if (valueOf(change[i]) >= v) revert NotAllowed(); // change must be smaller Sigils
        }
        got += _moveAll(change, TREASURY, from, ref);
        if (mintCommons > 0) _mint(from, mintCommons, true);
        if (got != v) revert ValueMismatch(v, got);
    }

    function _moveAll(uint32[] memory serials, uint32 from, uint32 to, bytes32 ref) private returns (uint256 value) {
        for (uint256 i; i < serials.length; i++) {
            uint32 s = serials[i];
            uint32 owner = ownerOf(s);
            if (owner != from) revert NotOwner(s, owner);
            _setOwner(s, to);
            value += valueOf(s);
        }
        balanceOf[from] -= value; balanceOf[to] += value;
        countOf[from] -= serials.length; countOf[to] += serials.length;
        emit Moved(from, to, serials, value, ref);
    }

    function _mint(uint32 to, uint32 count, bool change) private returns (uint32 first) {
        first = nextSerial;
        uint32 end = first + count;
        nextSerial = end;
        uint256 value;
        for (uint32 s = first; s < end; s++) {
            _setOwner(s, to);
            if (change) _changeMint[s >> 8] |= 1 << (s & 255);
            value += valueOf(s);
        }
        balanceOf[to] += value;
        countOf[to] += count;
        emit Minted(to, first, count, value, change);
    }

    function _setOwner(uint32 serial, uint32 owner) private {
        uint256 shift = (serial & 7) * 32;
        uint256 w = _owners[serial >> 3];
        _owners[serial >> 3] = (w & ~(uint256(0xFFFFFFFF) << shift)) | (uint256(owner) << shift);
    }

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address signer) {
        if (sig.length != 65) revert BadSignature();
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        if (uint256(s) > HALF_N || (v != 27 && v != 28)) revert BadSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert BadSignature();
    }

    function _decimal(uint32 n) private pure returns (bytes memory out) {
        uint32 len = 1;
        for (uint32 m = n; m >= 10; m /= 10) len++;
        out = new bytes(len);
        for (; len > 0; n /= 10) out[--len] = bytes1(uint8(48 + n % 10));
    }
}
