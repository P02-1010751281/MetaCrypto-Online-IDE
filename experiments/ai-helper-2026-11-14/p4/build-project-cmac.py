#!/usr/bin/env python3
"""P4 A 线 CMAC 切片 · 第 3 段：SP 800-38B CMAC 试点工程的生成器

产出（experiments/ai-helper-2026-11-14/p4/project-cmac/）：
  algo.cmac.block.json         procedure `CMAC_AES(key, msg)`（= cmac_mac）与 `CMAC_SUBKEYS(subkey)`（= cmac_subkeys）
  main.block.json              entry：RFC 4493 §4 的 key/msg → 四个长度（0/16/40/64）的标签 + 子密钥 K1‖K2
  cmac-rfc4493.project.json    ProjectRecord（files[] 里是上面两个负载的字符串，含 entryFileId 与 metadata.aiHelper）
  README.md                    文件角色与复现命令（数字取自本次构建）

块只来自仓库现有件：224 个项目块 + 画布原生核心块（variables_* / procedures_*）。
不新增块类型；缺的块记在 verdicts-sp800-38b-cmac.json 的 gaps 与报告里。

用法：python3 experiments/ai-helper-2026-11-14/p4/build-project-cmac.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path.cwd()
P4 = ROOT / "experiments/ai-helper-2026-11-14/p4"
PROJECT_DIR = P4 / "project-cmac"
ANCHORS = P4 / "anchors-sp800-38b-cmac.json"
VERDICTS = P4 / "verdicts-sp800-38b-cmac.json"
PRODUCT_INDEX = ROOT / "src/services/ai-helper/block-index.json"

# 构建时间与块 id 都固定：重复构建的产物字节相同（不把「今天」与随机 uuid 写进 artifact）。
BUILT_AT = "2026-11-18T10:00:00.000Z"

# RFC 4493 §4 的 AES-128 示例（与 tests/unit/cmac-block-contract.test.ts、demos/tests.json 的
# procedures/CMAC-AES.json 条目同源；那两处由仓库门禁跑）。
RFC_KEY_HEX = "2b7e151628aed2a6abf7158809cf4f3c"
RFC_MSG_HEX = (
    "6bc1bee22e409f96e93d7e117393172a"          # M1（16 字节）
    "ae2d8a571e03ac9c9eb76fac45af8e51"          # M2
    "30c81c46a35ce411e5fbc1191a0a52ef"          # M3
    "f69f2445df4f9b17ad2b417be66c3710"          # M4（共 64 字节）
)
RFC_TAGS = [
    ("tag0", 0, "bb1d6929e95937287fa37d129b756746"),
    ("tag16", 16, "070a16b46b4d4144f79bdd9dd04a287c"),
    ("tag40", 40, "dfa66747de9ae63030ca32611497c827"),
    ("tag64", 64, "51f0bebf7e3b9d92fc49741779363cfe"),
]
RFC_SUBKEYS = "fbeed618357133667c85e08f7236a8def7ddac306ae266ccf90bc11ee46d513b"

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


def hex_bytes(hex_text: str) -> dict:
    """Hex 字符串 → Bytes：`data_value`（String）+ `hex_to_bytes`（Bytes）。"""
    return block("hex_to_bytes", inputs={"INPUT": value_input(literal(hex_text))})


def slice_bytes(source: dict, start: str, end: str) -> dict:
    return block("pq_bytes_slice", inputs={
        "INPUT": value_input(source),
        "START": value_input(block("data_value", fields={"NUM": start})),
        "END": value_input(block("data_value", fields={"NUM": end})),
    })


def call(name: str, params: list[dict], args: list[dict]) -> dict:
    node = block("procedures_callreturn", fields={"NAME": name},
                 extraState={"params": params})
    for index, arg in enumerate(args):
        node.setdefault("inputs", {})[f"ARG{index}"] = value_input(arg)
    return node


def build_algo() -> dict:
    """两个 procedure：§6.1 的子密钥与 §6.2 的标签，各由对应原子块一步给出。"""
    tag_params = [
        {"name": "key", "id": "algo_param_key", "type": "bytes"},
        {"name": "msg", "id": "algo_param_msg", "type": "bytes"},
    ]
    tag_def = block(
        "procedures_defreturn",
        x=40, y=40,
        extraState={"params": tag_params, "hasStatements": False},
        fields={"NAME": "CMAC_AES"},
        inputs={"RETURN": value_input(block("cmac_mac", fields={"CIPHER": "aes"}, inputs={
            "KEY": value_input(get("algo_param_key", "key")),
            "MSG": value_input(get("algo_param_msg", "msg")),
        }))},
    )

    sub_params = [{"name": "subkey", "id": "sub_param_subkey", "type": "bytes"}]
    sub_def = block(
        "procedures_defreturn",
        x=40, y=320,
        extraState={"params": sub_params, "hasStatements": False},
        fields={"NAME": "CMAC_SUBKEYS"},
        inputs={"RETURN": value_input(block("cmac_subkeys", inputs={
            "KEY": value_input(get("sub_param_subkey", "subkey")),
        }))},
    )
    return {"blocks": {"languageVersion": 0, "blocks": [tag_def, sub_def]}}


def build_main() -> dict:
    """entry：RFC 4493 §4 的 key/msg → 四个长度的标签 + 子密钥，全部落在同名变量上。"""
    key = ("main_var_key", "key")
    msg = ("main_var_msg", "msg")
    set_key = set_var(*key, hex_bytes(RFC_KEY_HEX))
    set_msg = set_var(*msg, hex_bytes(RFC_MSG_HEX))

    chain = set_key
    tail = set_msg
    chain["next"] = wrap(tail)

    for name, length, _expected in RFC_TAGS:
        target = get(*msg) if length == len(RFC_MSG_HEX) // 2 else slice_bytes(get(*msg), "0", str(length))
        node = set_var(f"main_var_{name}", name, call(
            "CMAC_AES",
            [
                {"name": "key", "id": f"main_call_key_{name}", "type": "bytes"},
                {"name": "msg", "id": f"main_call_msg_{name}", "type": "bytes"},
            ],
            [get(*key), target],
        ))
        tail["next"] = wrap(node)
        tail = node

    node = set_var("main_var_subkeys", "subkeys", call(
        "CMAC_SUBKEYS",
        [{"name": "subkey", "id": "main_call_subkey", "type": "bytes"}],
        [get(*key)],
    ))
    tail["next"] = wrap(node)
    return {"blocks": {"languageVersion": 0, "blocks": [set_key]}}


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

    roles = {
        "algo.cmac.block.json": {
            "role": "procedure 定义：CMAC_AES(key, msg) 与 CMAC_SUBKEYS(subkey)",
            "covers": ["§6.1 子密钥生成", "§6.2 MAC 生成"],
            "blocks": algo_blocks,
            "notEntry": True,
        },
        "main.block.json": {
            "role": "entry 顶层演示：RFC 4493 §4 的 key/msg → 四个长度标签 + K1‖K2",
            "covers": ["§6.2 四种长度分支（空消息 / 整块 / 多块 / 不完整末块）"],
            "blocks": main_blocks,
            "notEntry": False,
        },
    }

    tags_expect = "\n".join([expected for _name, _len, expected in RFC_TAGS] + [RFC_SUBKEYS])
    tag16_expected = RFC_TAGS[1][2]

    tests = {
        "py": {
            "driver": "\n".join(
                [f"print(bytes({name}).hex())" for name, _len, _e in RFC_TAGS]
                + ["print(bytes(subkeys).hex())"]
            ),
            "expect": tags_expect,
        },
        "js": {
            "driver": "[" + ", ".join([name for name, _l, _e in RFC_TAGS] + ["subkeys"]) +
                      "].forEach(function (v) { console.log(Buffer.from(v).toString('hex')); });",
            "expect": tags_expect,
        },
        "vector": {
            "name": "RFC 4493 §4 (AES-128)",
            "key": RFC_KEY_HEX,
            "message": RFC_MSG_HEX,
            "lengths": [length for _n, length, _e in RFC_TAGS],
            "tags": {name: expected for name, _l, expected in RFC_TAGS},
            "subkeys": RFC_SUBKEYS,
            "note": "0 字节走 K2 空消息分支，16 字节走 K1 整块分支，40 字节不完整末块，64 字节多整块。",
        },
        "formattingGap": "标签是 Bytes；hex 格式化在 driver 里做（画布上有 bytes_to_hex，但本试点不在 entry 里绕一圈）。",
        # 阴性对照：把 16 字节消息截成 15 字节（末块不完整 → 走 K2 分支），标签必须 ≠ 16 字节官方向量。
        "control": {
            "note": "15 字节对照：末块由「整块 xor K1」改走「pad 后 xor K2」，输出必须 ≠ 16 字节官方向量",
            "mustDifferFrom": tag16_expected,
            "py": {
                "driver": "print(bytes(CMAC_AES(key, bytes(msg)[:15])).hex())",
            },
            "js": {
                "driver": "console.log(Buffer.from(CMAC_AES(key, msg.slice(0, 15))).toString('hex'));",
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

    project = {
        "id": "p4-sp800-38b-cmac-rfc4493",
        "name": f"NIST SP 800-38B CMAC（src {anchors['source']['sha256'][:8]}）",
        "language": "python",
        "format": "json",
        "createdAt": BUILT_AT,
        "updatedAt": BUILT_AT,
        "files": [
            {"fileId": "file-algo-cmac", "name": "algo.cmac.block.json",
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

    (PROJECT_DIR / "algo.cmac.block.json").write_text(
        json.dumps(algo, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (PROJECT_DIR / "main.block.json").write_text(
        json.dumps(entry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (PROJECT_DIR / "cmac-rfc4493.project.json").write_text(
        json.dumps(project, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"PROJECT files=2 algo_blocks={algo_blocks} main_blocks={main_blocks} total={algo_blocks + main_blocks}")
    print(f"PROJECT blockTypes={len(types)} unknown={len(unknown)} duplicateIds={len(duplicates)}")
    print(f"PROJECT entryFileId=file-main vectors={len(RFC_TAGS)} control=15B")


if __name__ == "__main__":
    main()
