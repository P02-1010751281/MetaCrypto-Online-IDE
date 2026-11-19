#!/usr/bin/env python3
"""P4 A 线 CCM 切片 · 第 3 段：SP 800-38C CCM 试点工程的生成器

产出（experiments/ai-helper-2026-11-14/p4/project-ccm/）：
  algo.ccm.block.json        七个 procedure：整段加密/解密（Example 1）与 Appendix A 的格式化原语
  main.block.json            entry：附录 C Example 1/2/3 的 K/N/A/P → 密文‖标签；Example 1 的中间量
  ccm-appendix-c.project.json ProjectRecord（files[] 里是两个负载的字符串，含 entryFileId 与 metadata.aiHelper）
  README.md                  文件角色、向量与复现命令（数字取自本次构建）

块只来自仓库现有件：224 个项目块 + 画布原生核心块（variables_* / procedures_*）。
不新增块类型；缺的块记在 verdicts-sp800-38c-ccm.json 的 gaps 与报告里。

官方向量：NIST SP 800-38C Appendix C.1–C.3（K/N/A/P 与 C‖T）。中间量（B0、Ctr0/Ctr1、
AAD 长度前缀、CBC-MAC 的 X）取自 Appendix C 的 B/Ctr/S0 与 T 行；X 由 AES-128 独立复算
（Python cryptography 的 AES-ECB 手搭 CBC-MAC，见报告），不是用本仓库生成器算的。

用法：python3 experiments/ai-helper-2026-11-14/p4/build-project-ccm.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path.cwd()
P4 = ROOT / "experiments/ai-helper-2026-11-14/p4"
PROJECT_DIR = P4 / "project-ccm"
ANCHORS = P4 / "anchors-sp800-38c-ccm.json"
VERDICTS = P4 / "verdicts-sp800-38c-ccm.json"
PRODUCT_INDEX = ROOT / "src/services/ai-helper/block-index.json"

# 构建时间与块 id 都固定：重复构建的产物字节相同（不把「今天」与随机 uuid 写进 artifact）。
BUILT_AT = "2026-11-18T11:00:00.000Z"

# 附录 C 的 AES-128 密钥（三个 Example 共用）与各例的输入。
# Example 1：Tlen=32, Nlen=56, Alen=64, Plen=32
# Example 2：Tlen=48, Nlen=64, Alen=128, Plen=128
# Example 3：Tlen=64, Nlen=96, Alen=160, Plen=192
APPENDIX_KEY_HEX = "404142434445464748494a4b4c4d4e4f"
EXAMPLES = [
    {
        "id": "ex1",
        "tagLen": 4,
        "nonce": [0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16],
        "aad": [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07],
        "msgHex": "20212223",
        "expected": "7162015b4dac255d",  # Appendix C.1 C（= C‖T）
        "t": "6084341b",
    },
    {
        "id": "ex2",
        "tagLen": 6,
        "nonce": [0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17],
        "aad": list(range(0x00, 0x10)),
        "msgHex": "202122232425262728292a2b2c2d2e2f",
        "expected": "d2a1f0e051ea5f62081a7792073d593d1fc64fbfaccd",
        "t": "7f479ffca464",
    },
    {
        "id": "ex3",
        "tagLen": 8,
        "nonce": [0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b],
        "aad": list(range(0x00, 0x14)),
        "msgHex": "202122232425262728292a2b2c2d2e2f3031323334353637",
        "expected": "e3b201a9f5b71a7a9b1ceaeccd97e70b6176aad9a4428aa5484392fbc1b09951",
        "t": "67c99240c7d51048",
    },
]

# Appendix C.1 的中间量（B0 / Ctr0 / Ctr1 / AAD 前缀 / CBC-MAC 的 X）。
# X = AES_K(AES_K(AES_K(B0) xor B1) xor B2)，由 cryptography 的 AES-ECB 独立复算，见 README。
EX1_INTERMEDIATES = {
    "b0": "4f101112131415160000000000000004",
    "cb0": "07101112131415160000000000000000",
    "cb1": "07101112131415160000000000000001",
    "aad8": "0008",
    "aad16": "0010",
    "macX": "6084341b32042bf000b4b7995553a3c5",
    "cipher": "7162015b",  # C.1 的 C 去掉 4 字节标签后的密文段
}

# 画布原生的 Blockly 核心块（不在 224 个项目块的索引里，但工具箱里有）。
CORE_BLOCKS = {
    "variables_get",
    "variables_set",
    "procedures_defreturn",
    "procedures_callreturn",
}

_counter = 0


def bid(prefix: str) -> str:
    """确定性块 id：按构建顺序编号，重复构建得到同一份 JSON（便于 diff 与哈希钉死）。"""
    global _counter
    _counter += 1
    return f"{prefix}_{_counter:03d}"


def block(kind: str, **extra) -> dict:
    node = {"type": kind, "id": bid(kind.replace(".", "_"))}
    node.update(extra)
    return node


def wrap(node: dict) -> dict:
    return {"block": node}


def value_input(node: dict) -> dict:
    return wrap(node)


def get(var_id: str, var_name: str) -> dict:
    return block("variables_get", fields={"VAR": {"id": var_id, "name": var_name}})


def set_var(var_id: str, var_name: str, value: dict) -> dict:
    return block("variables_set", fields={"VAR": {"id": var_id, "name": var_name}},
                 inputs={"VALUE": value_input(value)})


def literal(text: str) -> dict:
    """`data_value` 的 NUM 存带引号的字面量：生成器解析不出数字时原样输出字符串常量。"""
    return block("data_value", fields={"NUM": json.dumps(text)})


def number(value: int) -> dict:
    return block("data_value", fields={"NUM": str(value)})


def int_list(values: list[int]) -> dict:
    """`data_int_list`：扁平单元格 + shape 元数据（生成代码是一维列表字面量）。"""
    return block(
        "data_int_list",
        extraState={"shape": str(len(values)), "data": ",".join(str(v) for v in values)},
    )


def hex_bytes(hex_text: str) -> dict:
    """Hex 字符串 → Bytes：`data_value`（String）+ `hex_to_bytes`（Bytes）。"""
    return block("hex_to_bytes", inputs={"INPUT": value_input(literal(hex_text))})


def defreturn(name: str, params: list[tuple[str, str]], builder, x: int, y: int) -> dict:
    """procedure 定义：先建形参 variables_get，再建返回块，最后建 def（id 顺序与 CMAC 试点一致）。"""
    gets = {param: get(f"algo_{name.lower()}_{param}", param) for param, _type in params}
    node = builder(gets)
    state_params = [
        {"name": param, "id": f"algo_{name.lower()}_{param}", "type": param_type}
        for param, param_type in params
    ]
    return block(
        "procedures_defreturn",
        x=x, y=y,
        extraState={"params": state_params, "hasStatements": False},
        fields={"NAME": name},
        inputs={"RETURN": value_input(node)},
    )


def call(name: str, params: list[tuple[str, str]], args: list[dict]) -> dict:
    node = block(
        "procedures_callreturn",
        fields={"NAME": name},
        extraState={
            "params": [
                {"name": param, "id": f"main_{name.lower()}_{param}", "type": param_type}
                for param, param_type in params
            ]
        },
    )
    for index, arg in enumerate(args):
        node.setdefault("inputs", {})[f"ARG{index}"] = value_input(arg)
    return node


def build_algo() -> dict:
    """七个 procedure：Example 1 的整段加密/解密 + Appendix A 的五个格式化原语。"""
    defs = []

    encrypted = defreturn(
        "CCM_ENCRYPT_EX1",
        [("key", "key"), ("nonce", "int_list"), ("aad", "int_list"), ("msg", "message")],
        lambda p: block("ccm_encrypt", fields={"TAGLEN": "4"}, inputs={
            "KEY": value_input(p["key"]),
            "NONCE": value_input(p["nonce"]),
            "AAD": value_input(p["aad"]),
            "MSG": value_input(p["msg"]),
        }),
        40, 40,
    )
    defs.append(encrypted)

    decrypted = defreturn(
        "CCM_DECRYPT_EX1",
        [("key", "key"), ("nonce", "int_list"), ("aad", "int_list"), ("ct", "bytes")],
        lambda p: block("ccm_decrypt", fields={"TAGLEN": "4"}, inputs={
            "KEY": value_input(p["key"]),
            "NONCE": value_input(p["nonce"]),
            "AAD": value_input(p["aad"]),
            "CT": value_input(p["ct"]),
        }),
        40, 320,
    )
    defs.append(decrypted)

    b0 = defreturn(
        "CCM_B0",
        [("nonce", "int_list"), ("msgLen", "int"), ("aadLen", "int")],
        lambda p: block("ccm_b0", fields={"TAGLEN": "4"}, inputs={
            "NONCE": value_input(p["nonce"]),
            "MSGLEN": value_input(p["msgLen"]),
            "AADLEN": value_input(p["aadLen"]),
        }),
        40, 520,
    )
    defs.append(b0)

    counter = defreturn(
        "CCM_COUNTER_BLOCK",
        [("nonce", "int_list"), ("i", "int")],
        lambda p: block("ccm_counter_block", fields={"TAGLEN": "4"}, inputs={
            "NONCE": value_input(p["nonce"]),
            "I": value_input(p["i"]),
        }),
        40, 700,
    )
    defs.append(counter)

    cbc_mac = defreturn(
        "CCM_CBC_MAC",
        [("key", "key"), ("nonce", "int_list"), ("aad", "int_list"), ("msg", "message")],
        lambda p: block("ccm_cbc_mac", fields={"TAGLEN": "4"}, inputs={
            "KEY": value_input(p["key"]),
            "NONCE": value_input(p["nonce"]),
            "AAD": value_input(p["aad"]),
            "MSG": value_input(p["msg"]),
        }),
        40, 860,
    )
    defs.append(cbc_mac)

    ctr = defreturn(
        "CCM_CTR",
        [("key", "key"), ("nonce", "int_list"), ("msg", "message")],
        lambda p: block("ccm_ctr", fields={"TAGLEN": "4"}, inputs={
            "KEY": value_input(p["key"]),
            "NONCE": value_input(p["nonce"]),
            "MSG": value_input(p["msg"]),
        }),
        40, 1060,
    )
    defs.append(ctr)

    aad_prefix = defreturn(
        "CCM_AAD_PREFIX",
        [("aadLen", "int")],
        lambda p: block("ccm_aad_len_prefix", inputs={"AADLEN": value_input(p["aadLen"])}),
        40, 1220,
    )
    defs.append(aad_prefix)

    return {"blocks": {"languageVersion": 0, "blocks": defs}}


def build_main() -> dict:
    """entry：附录 C 三例的输入 → 密文‖标签；Example 1 再算一遍中间量，逐项对上 Appendix C。"""
    key = ("main_var_key", "key")
    vars_for = {}
    statements = [set_var(*key, hex_bytes(APPENDIX_KEY_HEX))]

    for example in EXAMPLES:
        eid = example["id"]
        nonce_var = (f"main_var_nonce_{eid}", f"nonce_{eid}")
        aad_var = (f"main_var_aad_{eid}", f"aad_{eid}")
        msg_var = (f"main_var_msg_{eid}", f"msg_{eid}")
        vars_for[eid] = {"nonce": nonce_var, "aad": aad_var, "msg": msg_var}
        statements.append(set_var(*nonce_var, int_list(example["nonce"])))
        statements.append(set_var(*aad_var, int_list(example["aad"])))
        statements.append(set_var(*msg_var, hex_bytes(example["msgHex"])))

    ex1 = EXAMPLES[0]
    ex1_vars = vars_for["ex1"]
    out1 = ("main_var_out_ex1", "out_ex1")
    statements.append(set_var(*out1, call(
        "CCM_ENCRYPT_EX1",
        [("key", "key"), ("nonce", "int_list"), ("aad", "int_list"), ("msg", "message")],
        [get(*key), get(*ex1_vars["nonce"]), get(*ex1_vars["aad"]), get(*ex1_vars["msg"])],
    )))

    for example in EXAMPLES[1:]:
        eid = example["id"]
        ev = vars_for[eid]
        out = (f"main_var_out_{eid}", f"out_{eid}")
        statements.append(set_var(*out, block("ccm_encrypt", fields={"TAGLEN": str(example["tagLen"])}, inputs={
            "KEY": value_input(get(*key)),
            "NONCE": value_input(get(*ev["nonce"])),
            "AAD": value_input(get(*ev["aad"])),
            "MSG": value_input(get(*ev["msg"])),
        })))

    decrypted = ("main_var_dec_ex1", "dec_ex1")
    statements.append(set_var(*decrypted, call(
        "CCM_DECRYPT_EX1",
        [("key", "key"), ("nonce", "int_list"), ("aad", "int_list"), ("ct", "bytes")],
        [get(*key), get(*ex1_vars["nonce"]), get(*ex1_vars["aad"]), get(*out1)],
    )))

    # Example 1 的中间量：B0、Ctr0/Ctr1、AAD 长度前缀、CBC-MAC 的 X、CTR 的密文段。
    b0 = ("main_var_b0", "b0")
    statements.append(set_var(*b0, call(
        "CCM_B0",
        [("nonce", "int_list"), ("msgLen", "int"), ("aadLen", "int")],
        [get(*ex1_vars["nonce"]), number(len(ex1["msgHex"]) // 2), number(len(ex1["aad"]))],
    )))

    for name, index in (("cb0", 0), ("cb1", 1)):
        target = (f"main_var_{name}", name)
        statements.append(set_var(*target, call(
            "CCM_COUNTER_BLOCK",
            [("nonce", "int_list"), ("i", "int")],
            [get(*ex1_vars["nonce"]), number(index)],
        )))

    for name, length in (("aad8", 8), ("aad16", 16)):
        target = (f"main_var_{name}", name)
        statements.append(set_var(*target, call(
            "CCM_AAD_PREFIX", [("aadLen", "int")], [number(length)],
        )))

    mac_x = ("main_var_mac_x", "mac_x")
    statements.append(set_var(*mac_x, call(
        "CCM_CBC_MAC",
        [("key", "key"), ("nonce", "int_list"), ("aad", "int_list"), ("msg", "message")],
        [get(*key), get(*ex1_vars["nonce"]), get(*ex1_vars["aad"]), get(*ex1_vars["msg"])],
    )))

    cipher = ("main_var_cipher", "cipher")
    statements.append(set_var(*cipher, call(
        "CCM_CTR",
        [("key", "key"), ("nonce", "int_list"), ("msg", "message")],
        [get(*key), get(*ex1_vars["nonce"]), get(*ex1_vars["msg"])],
    )))

    for first, second in zip(statements, statements[1:]):
        first["next"] = wrap(second)
    return {"blocks": {"languageVersion": 0, "blocks": [statements[0]]}}


def is_block(node: dict) -> bool:
    """块对象判定：有 type，且不是 procedure 参数声明 {name, id, type}。"""
    if not isinstance(node.get("type"), str):
        return False
    if "name" in node and set(node) <= {"name", "id", "type"}:
        return False
    return True


def iter_blocks(node) -> list[dict]:
    """按序列化树遍历所有块对象（inputs / next / shadow 都在值里，直接递归即可）。"""
    found: list[dict] = []
    stack = [node]
    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            if is_block(current):
                found.append(current)
            for key, value in current.items():
                if key != "extraState":
                    stack.append(value)
        elif isinstance(current, list):
            stack.extend(current)
    return found


VAR_ORDER = ["out_ex1", "out_ex2", "out_ex3", "dec_ex1", "b0", "cb0", "cb1", "aad8", "aad16", "mac_x", "cipher"]


def main() -> None:
    PROJECT_DIR.mkdir(parents=True, exist_ok=True)
    anchors = json.loads(ANCHORS.read_text(encoding="utf-8"))
    verdicts = json.loads(VERDICTS.read_text(encoding="utf-8"))
    known = {item["blockType"] for item in json.loads(PRODUCT_INDEX.read_text(encoding="utf-8"))["blocks"]}

    algo = build_algo()
    entry = build_main()

    types: set[str] = set()
    ids: dict[str, int] = {}
    for tree in (algo, entry):
        for node in iter_blocks(tree):
            types.add(node["type"])
            ids[node["id"]] = ids.get(node["id"], 0) + 1
    unknown = sorted(types - known - CORE_BLOCKS)
    duplicates = sorted(name for name, count in ids.items() if count > 1)
    if unknown:
        raise SystemExit(f"用了仓库里没有的块类型：{unknown}")
    if duplicates:
        raise SystemExit(f"块 id 重复：{duplicates}")

    def count_blocks(tree: dict) -> int:
        return len(iter_blocks(tree))

    algo_blocks = count_blocks(algo)
    main_blocks = count_blocks(entry)

    expected_lines = [
        EXAMPLES[0]["expected"],
        EXAMPLES[1]["expected"],
        EXAMPLES[2]["expected"],
        EXAMPLES[0]["msgHex"],
        EX1_INTERMEDIATES["b0"],
        EX1_INTERMEDIATES["cb0"],
        EX1_INTERMEDIATES["cb1"],
        EX1_INTERMEDIATES["aad8"],
        EX1_INTERMEDIATES["aad16"],
        EX1_INTERMEDIATES["macX"],
        EX1_INTERMEDIATES["cipher"],
    ]
    expected = "\n".join(expected_lines)

    tests = {
        "py": {
            "driver": "\n".join(f"print(bytes({name}).hex())" for name in VAR_ORDER),
            "expect": expected,
        },
        "js": {
            "driver": "[" + ", ".join(VAR_ORDER) + "].forEach(function (v) { " +
                      "console.log(Buffer.from(v).toString('hex')); });",
            "expect": expected,
        },
        "vector": {
            "name": "NIST SP 800-38C Appendix C Example 1/2/3 (AES-128)",
            "key": APPENDIX_KEY_HEX,
            "examples": [
                {
                    "id": example["id"],
                    "tagLen": example["tagLen"],
                    "nonce": "".join(f"{b:02x}" for b in example["nonce"]),
                    "aad": "".join(f"{b:02x}" for b in example["aad"]),
                    "message": example["msgHex"],
                    "ciphertextWithTag": example["expected"],
                    "t": example["t"],
                }
                for example in EXAMPLES
            ],
            "intermediates": EX1_INTERMEDIATES,
            "note": "Appendix C 的 C 行本身就是 C‖T（密文段 + 已掩码标签）；T 行是掩码前的 MAC。",
        },
        "formattingGap": "所有中间量与标签都是 Bytes/IntList；hex 格式化在 driver 里做，entry 不在画布上绕 bytes_to_hex。",
        "control": {
            "note": "翻转 Example 1 标签最后一个 bit：ccm_decrypt 必须抛错（TAG-REJECTED），不得返回明文 20212223",
            "mustDifferFrom": EXAMPLES[0]["msgHex"],
            "py": {
                "driver": "\n".join([
                    "_bad = bytes(out_ex1)[:-1] + bytes([bytes(out_ex1)[-1] ^ 1])",
                    "try:",
                    "    ccm_decrypt(key, nonce_ex1, aad_ex1, _bad, 4)",
                    "    print('TAG-ACCEPTED')",
                    "except ValueError:",
                    "    print('TAG-REJECTED')",
                ]),
            },
            "js": {
                "driver": "\n".join([
                    "var bad = Array.from(out_ex1); bad[bad.length - 1] ^= 1;",
                    "try { ccmDecrypt(key, nonce_ex1, aad_ex1, bad, 4); console.log('TAG-ACCEPTED'); }",
                    "catch (err) { console.log('TAG-REJECTED'); }",
                ]),
            },
        },
    }

    coverage = {
        "clauses": verdicts["counts"]["clauses"],
        "build": verdicts["counts"]["build"],
        "partial": verdicts["counts"]["partial"],
        "missing": verdicts["counts"]["missing"],
        "evidenceLayers": verdicts["counts"]["evidenceLayers"],
        "clausesWithSameVariantL2": verdicts["counts"]["clausesWithSameVariantL2"],
        "gaps": [
            {"clauseId": clause["clauseId"], "gaps": clause["gaps"]}
            for clause in verdicts["clauses"]
        ],
        "semantic_equivalence": "unverified",
    }

    roles = {
        "algo.ccm.block.json": {
            "role": "procedure 定义：整段加密/解密 + Appendix A 的格式化原语（B0 / Ctr(i) / AAD 前缀 / CBC-MAC / CTR）",
            "covers": ["§6.1 生成-加密", "§6.2 解密-验证", "§A.2 格式化", "§A.3 计数器"],
            "blocks": algo_blocks,
            "notEntry": True,
        },
        "main.block.json": {
            "role": "entry 顶层演示：Appendix C Example 1/2/3 的 K/N/A/P → C‖T，并复算 Example 1 的 B0/Ctr/AAD 前缀/CBC-MAC X/CTR 密文段",
            "covers": ["附录 C.1–C.3 三组官方向量", "Example 1 的中间量交叉核对"],
            "blocks": main_blocks,
            "notEntry": False,
        },
    }

    project = {
        "id": "p4-sp800-38c-ccm-appendix-c",
        "name": f"NIST SP 800-38C CCM（src {anchors['source']['sha256'][:8]}）",
        "language": "python",
        "format": "json",
        "createdAt": BUILT_AT,
        "updatedAt": BUILT_AT,
        "files": [
            {"fileId": "file-algo-ccm", "name": "algo.ccm.block.json",
             "format": "json", "workspace": json.dumps(algo, ensure_ascii=False, indent=1)},
            {"fileId": "file-main", "name": "main.block.json", "format": "json",
             "isEntry": True, "workspace": json.dumps(entry, ensure_ascii=False, indent=1)},
        ],
        "entryFileId": "file-main",
        "metadata": {
            "aiHelper": {
                "schemaVersion": 1,
                "kind": "standards-to-project",
                "standard": anchors["standard"],
                "source": anchors["source"],
                "anchors": anchors["clauseUnits"],
                "coverage": coverage,
                "verdicts": [
                    {
                        "clauseId": clause["clauseId"],
                        "tier": clause["tier"],
                        "tierReason": clause["tierReason"],
                        "evidenceLayer": clause["evidenceLayer"],
                        "steps": clause["stepCounts"],
                        "gaps": clause["gaps"],
                    }
                    for clause in verdicts["clauses"]
                ],
                "tests": tests,
                "project": {"roles": roles, "blockTypes": sorted(types)},
                "semantic_equivalence": "unverified",
            }
        },
    }

    (PROJECT_DIR / "algo.ccm.block.json").write_text(
        json.dumps(algo, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (PROJECT_DIR / "main.block.json").write_text(
        json.dumps(entry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (PROJECT_DIR / "ccm-appendix-c.project.json").write_text(
        json.dumps(project, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    readme = f"""# SP 800-38C CCM 试点工程（P4 A 线第三条纵向切片）

NIST SP 800-38C 的 AES-CCM，用**仓库现有块**搭出的多文件 project，向量取 Appendix C
Example 1/2/3（Tlen 4/6/8；Nlen 56/64/96；Alen 64/128/160；Plen 32/128/192）。
与前两条切片的区别：CCM 的分解链更长（格式化 → CBC-MAC → CTR → 标签掩码），且三处
`IntList`→`Bytes` 的类型门在画布上被拒（`../connect-probe-sp800-38c-ccm.json`），
所以格式化产物只能整体走 `ccm_encrypt`/`ccm_cbc_mac`/`ccm_ctr` 的闭包。

## 文件与角色

| 文件 | 角色 | 块数 |
|---|---|---:|
| `algo.ccm.block.json` | 七个 procedure：`CCM_ENCRYPT_EX1` / `CCM_DECRYPT_EX1`（整段）与 `CCM_B0` / `CCM_COUNTER_BLOCK` / `CCM_CBC_MAC` / `CCM_CTR` / `CCM_AAD_PREFIX`（Appendix A 原语） | {algo_blocks} |
| `main.block.json` | entry：Example 1/2/3 的 K/N/A/P → `C‖T`；Example 1 再算 B0、Ctr0/Ctr1、AAD 前缀、CBC-MAC 的 X、CTR 密文段 | {main_blocks} |
| `ccm-appendix-c.project.json` | `ProjectRecord`：`files[]` 里是上面两个负载的字符串，`entryFileId = file-main`，覆盖报告与锚点在 `metadata.aiHelper`（**不进** `files[]`） | — |

`entryFileId` 决定生成顺序与「原语只注入一次」：`algo` 先出、`main` 最后出。

## 官方向量（Appendix C）

| 例 | Tlen | Nlen | Alen | Plen | C‖T | 掩码前 T |
|---|---:|---:|---:|---:|---|---|
| 1 | 4 | 7 | 8 | 4 | `{EXAMPLES[0]["expected"]}` | `{EXAMPLES[0]["t"]}` |
| 2 | 6 | 8 | 16 | 16 | `{EXAMPLES[1]["expected"]}` | `{EXAMPLES[1]["t"]}` |
| 3 | 8 | 12 | 20 | 24 | `{EXAMPLES[2]["expected"]}` | `{EXAMPLES[2]["t"]}` |

Example 1 的中间量：B0 `{EX1_INTERMEDIATES["b0"]}`、Ctr0 `{EX1_INTERMEDIATES["cb0"]}`、
Ctr1 `{EX1_INTERMEDIATES["cb1"]}`、AAD 前缀（a=8/16）`{EX1_INTERMEDIATES["aad8"]}`/`{EX1_INTERMEDIATES["aad16"]}`、
CBC-MAC 的 X `{EX1_INTERMEDIATES["macX"]}`、CTR 密文段 `{EX1_INTERMEDIATES["cipher"]}`。

X 不是本仓库生成器算的：用 `cryptography` 的 AES-ECB 按 CBC-MAC 手搭
（`Y0=E(B0)`、`Yi=E(Y(i-1) xor Bi)`）独立复算，再与 `T xor S0` 的前 4 字节对齐 Appendix C.1 的 `T`。

## 复现（仓库根执行）

```bash
# 第 3 段：重新生成本目录（读同目录的 anchors/verdicts，两者须先跑）
python3 experiments/ai-helper-2026-11-14/p4/build-project-ccm.py

# 第 4 段：结构 / 生成 / 类型 / 双语言向量
AIVERIFY_ENTRY=scripts/verify-project.ts AIVERIFY_OUTDIR=dist-verify/a-ccm-project \\
  npx vite build --config vite.verify.config.ts
node dist-verify/a-ccm-project/verify-project.js \\
  experiments/ai-helper-2026-11-14/p4/project-ccm/ccm-appendix-c.project.json \\
  --exec --out experiments/ai-helper-2026-11-14/p4/verify-project-readings-ccm.json
```

## 这个工程不证明什么

- 不证明块与 SP 800-38C 伪代码逐行等价（`semantic_equivalence: unverified`）。
- 不证明认证或标准符合性；也不构成常量时间或认证安全证明。
- **分解链的三处类型门在画布上不通**：`ccm_b0` / `ccm_counter_block` / `ccm_aad_len_prefix`
  输出 `IntList`，`ccm_cbc_mac.MSG` / `ccm_ctr.MSG` / `mode_ecb_encrypt.DATA` 要 `Bytes`；
  224 块里没有 `IntList→Bytes` 转换块（证据：`../connect-probe-sp800-38c-ccm.json`）。
  工程只用现有块，不补转换块。
- `ccm_*` 块只实现 AES-128（没有 SM4 路径）；本试点只覆盖附录 C 的 4/6/8 字节标签，其他 nonce 长度与 bit 级 Tlen 不进本试点。
"""
    (PROJECT_DIR / "README.md").write_text(readme, encoding="utf-8")

    print(f"PROJECT files=2 algo_blocks={algo_blocks} main_blocks={main_blocks} total={algo_blocks + main_blocks}")
    print(f"PROJECT blockTypes={len(types)} unknown={len(unknown)} duplicateIds={len(duplicates)}")
    print(f"PROJECT entryFileId=file-main examples={len(EXAMPLES)} intermediates={len(EX1_INTERMEDIATES)} control=tag-flip")


if __name__ == "__main__":
    main()
