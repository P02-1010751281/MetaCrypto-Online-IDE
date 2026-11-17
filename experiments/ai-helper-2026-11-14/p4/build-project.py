#!/usr/bin/env python3
"""P4 A 线纵向切片 · 第 3 段：SHA-256 多分组试点工程的生成器

产出（experiments/ai-helper-2026-11-14/p4/project/）：
  algo.sha256.block.json         procedure `SHA256_Multiblock(msg)`：填充 → 分组迭代 → 返回 8 个链状态字
  main.block.json                entry：FIPS 180-4 B.2 的 448-bit 消息 → 调用 → digest 变量
  sha256-multiblock.project.json ProjectRecord（files[] 里是上面两个负载的字符串，含 entryFileId 与 metadata.aiHelper）
  README.md                      文件角色与复现命令（数字取自本次构建）

块只来自仓库现有件：222 个项目块 + 画布原生核心块（variables_* / math_* / procedures_*）。
不新增块类型；缺的块记在 verdicts.json 的 gaps 与报告里。

用法：python3 experiments/ai-helper-2026-11-14/p4/build-project.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path.cwd()
P4 = ROOT / "experiments/ai-helper-2026-11-14/p4"
PROJECT_DIR = P4 / "project"
ANCHORS = P4 / "anchors.json"
VERDICTS = P4 / "verdicts.json"
PRODUCT_INDEX = ROOT / "src/services/ai-helper/block-index.json"

# 构建时间与块 id 都固定：重复构建的产物字节相同（不把「今天」与随机 uuid 写进 artifact）。
BUILT_AT = "2026-11-17T12:00:00.000Z"
FIPS_B2_MESSAGE = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"
FIPS_B2_DIGEST = "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
SHA256_IV = "[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]"

# 画布原生的 Blockly 核心块（不在 222 个项目块的索引里，但工具箱里有）。
CORE_BLOCKS = {
    "variables_get",
    "variables_set",
    "math_arithmetic",
    "math_round",
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


def data(num: str) -> dict:
    return block("data_value", fields={"NUM": num})


def arithmetic(op: str, left: dict, right: dict) -> dict:
    return block("math_arithmetic", fields={"OP": op},
                 inputs={"A": value_input(left), "B": value_input(right)})


def build_algo() -> dict:
    """procedure SHA256_Multiblock(msg)：§5.1 填充 + §5.2/§6.2.2 分组迭代。"""
    padded = ("algo_var_padded", "padded")
    state = ("algo_var_state", "state")
    count = ("algo_var_blocks", "blocks")
    offset = ("algo_var_offset", "offset")
    loop_var = ("algo_var_i", "i")

    padded_value = block("hash_sha256_pad", inputs={"INPUT": value_input(get("algo_param_msg", "msg"))})

    # blocks = floor(bitlen(padded) / 512)：原生数学块，Python 侧回落到 math.floor，range() 才收整数。
    block_count = arithmetic("DIVIDE", block("data_bit_length", inputs={"X": value_input(get(*padded))}), data("512"))
    floor_count = block("math_round", fields={"OP": "ROUNDDOWN"}, inputs={"NUM": value_input(block_count)})

    # offset = i * 64
    step_offset = set_var(offset[0], offset[1], arithmetic("MULTIPLY", get(*loop_var), data("64")))
    # state = compress(state, slice(padded, offset, offset + 64))
    chunk = block("pq_bytes_slice", inputs={
        "INPUT": value_input(get(*padded)),
        "START": value_input(get(*offset)),
        "END": value_input(arithmetic("ADD", get(*offset), data("64"))),
    })
    step_compress = set_var(state[0], state[1], block("hash_sha256_compress", inputs={
        "V": value_input(get(*state)),
        "W": value_input(chunk),
    }))
    step_offset["next"] = wrap(step_compress)
    iterate = block("ctrl_iterate",
                    fields={"VAR": loop_var[1]},
                    inputs={"TIMES": value_input(get(*count)), "DO": value_input(step_offset)})

    set_padded = set_var(padded[0], padded[1], padded_value)
    set_state = set_var(state[0], state[1], data(SHA256_IV))
    set_count = set_var(count[0], count[1], floor_count)
    set_padded["next"] = wrap(set_state)
    set_state["next"] = wrap(set_count)
    set_count["next"] = wrap(iterate)

    definition = block(
        "procedures_defreturn",
        x=40, y=40,
        extraState={"params": [{"name": "msg", "id": "algo_param_msg", "type": "message"}],
                    "hasStatements": True},
        fields={"NAME": "SHA256_Multiblock"},
        inputs={"STACK": value_input(set_padded), "RETURN": value_input(get(*state))},
    )
    return {"blocks": {"languageVersion": 0, "blocks": [definition]}}


def build_main() -> dict:
    """entry：B.2 的 448-bit 消息 → SHA256_Multiblock(msg) → digest。"""
    set_message = set_var("main_var_msg", "msg", data(json.dumps(FIPS_B2_MESSAGE)))
    call = block("procedures_callreturn",
                 fields={"NAME": "SHA256_Multiblock"},
                 extraState={"params": [{"name": "msg", "id": "main_param_msg", "type": "message"}]},
                 inputs={"ARG0": value_input(get("main_var_msg", "msg"))})
    set_digest = set_var("main_var_digest", "digest", call)
    set_message["next"] = wrap(set_digest)
    return {"blocks": {"languageVersion": 0, "blocks": [set_message]}}


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
        "algo.sha256.block.json": {
            "role": "procedure 定义：SHA256_Multiblock(msg)",
            "covers": ["§5.1 填充", "§5.2 解析", "§6.2.2 分组迭代"],
            "blocks": algo_blocks,
            "notEntry": True,
        },
        "main.block.json": {
            "role": "entry 顶层演示：B.2 消息字面量 → 调用 → digest 变量",
            "covers": ["§6.2.2 迭代的一次真实调用"],
            "blocks": main_blocks,
            "notEntry": False,
        },
    }

    tests = {
        "py": {
            "driver": "print(''.join(f'{w:08x}' for w in digest))",
            "expect": FIPS_B2_DIGEST,
        },
        "js": {
            "driver": "console.log(digest.map(w => (w >>> 0).toString(16).padStart(8, '0')).join(''));",
            "expect": FIPS_B2_DIGEST,
        },
        "vector": {
            "name": "FIPS 180-4 Appendix B.2 (448-bit message)",
            "messageBits": 448,
            "paddedBits": 1024,
            "blocks": 2,
            "digest": FIPS_B2_DIGEST,
            "note": "448 + 1 + 511 + 64 = 1024 bit，填充后确为两个 512-bit 分组；单分组 demo 跑不到这条迭代。",
        },
        "formattingGap": "digest 取 8 个 32-bit 字；8 字 → 32 字节的大端打包在画布上没有块，由 driver 格式化（见 coverage.gaps）。",
        # 阴性对照：只压缩第一个分组（现有单分组 demo 的形态），结果必须**不等于**官方向量。
        # 它证明这条向量真的走到了两分组迭代，而不是「碰巧也算对」。
        "control": {
            "note": "单分组对照：只对第一个 512-bit 分组调用 compress，输出必须 ≠ 官方向量",
            "mustDifferFrom": FIPS_B2_DIGEST,
            "py": {
                "driver": "print(''.join(f'{w:08x}' for w in sha256_compress("
                          f"{SHA256_IV}, sha256_pad(msg)[0:64])))",
            },
            "js": {
                "driver": "console.log(sha256Compress(" + SHA256_IV +
                          ", sha256Pad(msg).slice(0, 64)).map(w => (w >>> 0).toString(16).padStart(8, '0')).join(''));",
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
        "id": "p4-fips180-4-sha256-multiblock",
        "name": f"FIPS 180-4 SHA-256 多分组（src {anchors['source']['sha256'][:8]}）",
        "language": "python",
        "format": "json",
        "createdAt": BUILT_AT,
        "updatedAt": BUILT_AT,
        "files": [
            {"fileId": "file-algo-sha256", "name": "algo.sha256.block.json",
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

    (PROJECT_DIR / "algo.sha256.block.json").write_text(
        json.dumps(algo, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (PROJECT_DIR / "main.block.json").write_text(
        json.dumps(entry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (PROJECT_DIR / "sha256-multiblock.project.json").write_text(
        json.dumps(project, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"PROJECT files=2 algo_blocks={algo_blocks} main_blocks={main_blocks} total={algo_blocks + main_blocks}")
    print(f"PROJECT blockTypes={len(types)} unknown={len(unknown)} duplicateIds={len(duplicates)}")
    print(f"PROJECT entryFileId=file-main vector={FIPS_B2_DIGEST}")


if __name__ == "__main__":
    main()
