#!/usr/bin/env python3
"""Interaction matrix: exact energy bookkeeping for stacked post-refiner dials (atlas design 4.1 and 12.1).

  python tests/test_dial_interactions.py      (same ComfyUI lookup as test_dial_rack.py)

CPU only. Identical, opposing, orthogonal, mixed-sign and zero vectors; the identity |sum|^2 = own + pairs; pushes that
add up to |sum|; the rack report's reinforcing / cancelling lines; and the route payload, which never mixes pre and post.
"""
import math
import tempfile

from test_dial_rack import H, core, dial, folder_paths, torch

INVALID = (math.nan, math.inf, -math.inf)


def bookkeeping(vecs, strengths):
    v = torch.stack([x.double() for x in vecs])
    return core.interactions(v @ v.T, strengths)


def finite(it):
    flat = [it["combined"]]
    for value in it.values():
        if isinstance(value, list):
            flat += [x for row in value for x in (row if isinstance(row, list) else [row])]
    assert all(x not in INVALID and x == x for x in flat), it


def close(a, b, tol=1e-9):
    assert abs(a - b) <= tol * max(1, abs(b)), (a, b)


def main():
    a, b, c = (dial("post", seed, name)["vec"] for seed, name in ((21, "a"), (22, "b"), (23, "c")))
    e0, e1, e2 = torch.eye(H)[:3]

    same = bookkeeping([a, a], [1, 1])
    close(same["cos"][0][1], 1)
    close(same["pair_share"][0][1], 0.5)  # |2a|^2 = 4|a|^2: own 1 + 1, pair 2
    close(same["combined"], 2 * float(a.double().norm()))
    assert same["pair"][0][1] > 0

    opposed = bookkeeping([a, -a], [1, 1])
    close(opposed["cos"][0][1], -1)
    assert opposed["combined"] == 0 and opposed["push"] == [0.0, 0.0] and opposed["pair_share"][0][1] == 0
    assert opposed["pair"][0][1] < 0
    finite(opposed)

    flipped = bookkeeping([a, a], [1, -0.5])
    assert flipped["pair"][0][1] < 0 and flipped["cos"][0][1] > 0, "a negative strength must flip the pair's sign"
    close(flipped["combined"], 0.5 * float(a.double().norm()))

    ortho = bookkeeping([3 * e0, 4 * e1], [1, 1])
    assert ortho["cos"][0][1] == 0 and ortho["pair"][0][1] == 0
    close(ortho["own_share"][0], 9 / 25)
    close(ortho["push"][0], 9 / 5)  # 3 e0 · (3 e0 + 4 e1) / 5
    p = e0 + e1  # globally orthogonal rows can still push the same probe
    assert float(3 * e0 @ p) > 0 and float(4 * e1 @ p) > 0

    zero = bookkeeping([a, torch.zeros(H), b], [1, 2, -0.5])
    finite(zero)
    assert zero["cos"][1] == [0.0, 0.0, 0.0] and zero["own"][1] == 0 and zero["push"][1] == 0
    nothing = bookkeeping([torch.zeros(H), torch.zeros(H)], [1, 1])
    finite(nothing)
    assert nothing["combined"] == 0 and nothing["cos"] == [[0.0, 0.0], [0.0, 0.0]]
    tiny = bookkeeping([1e-30 * e0, e1], [1, 1])
    finite(tiny)
    close(tiny["cos"][0][0], 1)

    mixed = bookkeeping([a, b, c, a + 0.5 * b], [0.7, -1.2, 0.4, 1.5])
    total = 0.7 * a.double() - 1.2 * b.double() + 0.4 * c.double() + 1.5 * (a + 0.5 * b).double()
    close(mixed["combined"], float(total.norm()))
    close(sum(mixed["own"]) + sum(mixed["pair"][i][j] for i in range(4) for j in range(i + 1, 4)), float(total @ total))
    close(sum(mixed["own_share"]) + sum(mixed["pair_share"][i][j] for i in range(4) for j in range(i + 1, 4)), 1)
    close(sum(mixed["push"]), mixed["combined"])
    unit = total / total.norm()
    close(mixed["push"][1], float(-1.2 * b.double() @ unit))
    assert all(mixed["pair"][i][i] == 0 for i in range(4))

    labels = ["motion", "dread", "grade"]
    lines = core.interaction_lines(labels, bookkeeping([e0 + e1, e0, e0 - e2], [1, 1, -1]))
    assert lines[0].startswith("pairs add"), lines
    assert any(x.startswith("reinforcing: motion × dread") for x in lines), lines
    assert any(x.startswith("cancelling: ") and "× grade" in x for x in lines), lines
    assert lines[-1].startswith("push along the sum: motion "), lines
    assert core.interaction_lines(labels[:2], opposed) == ["the post-refiner rows sum to zero"]
    assert not any(x.startswith(("reinforcing", "cancelling")) for x in core.interaction_lines(labels[:2], ortho))

    with tempfile.TemporaryDirectory(prefix="M1_interactions_") as tmp:
        folder_paths.add_model_folder_path("loras", tmp, is_default=True)
        A, B, P = dial("post", 21, "ia"), dial("post", 22, "ib"), dial("pre", 24, "ip")
        for d in (A, B, P):
            core.save_dial(d, d["meta"]["name"])
        rows = [{"dial": f"dials/{n}.safetensors", "strength": s} for n, s in (("ia", 1), ("ip", 0.5), ("ib", -0.5))]
        out = core.dial_interactions(rows)
        assert out["mode"] == ["post", "pre", "post"] and out["post"] == [0, 2]
        assert out["dot"][0][1] is None and out["dot"][1][2] is None and out["dot"][1][1] is not None, "pre and post mixed"
        loaded = [core.load_dial(r["dial"])["vec"].double() for r in rows]
        close(out["dot"][0][2], float(loaded[0] @ loaded[2]))
        expected = bookkeeping([loaded[0], loaded[2]], [1, -0.5])
        assert out["interactions"] == expected, "route bookkeeping != direct bookkeeping"
        assert "interactions" not in core.dial_interactions([rows[1]]), "pre rows have no post matrix"

        report = core.rack_report([("ia", A, 1.0), ("ip", P, 0.5), ("ib", B, 1.0), ("ia again", A, 1.0)])
        assert "combined post-refiner shift" in report and "reinforcing: ia × ia again +" in report, report
        assert "ip ×" not in report and "× ip" not in report, "a pre row entered the post matrix"
    print("dial interactions: identical, opposing, orthogonal, mixed-sign, zero, report and route checks passed")


if __name__ == "__main__":
    main()
