"""Rebuild the bundled fp16 MDX model with a shorter fixed time axis.

From the repository root (onnx==1.19.1, onnxruntime==1.19.2, numpy==2.0.2):
  git show 8430989:src/separator/model/vocals.onnx > /tmp/vocals-512.onnx
  python tools/shorten_mdx.py /tmp/vocals-512.onnx src/separator/model/vocals.onnx

The two transposes put frequency last for the learned MatMul projections.
Time has no learned matrix of its own; it must survive five stride-2 stages
and align again at the decoder skips. Shortening it changes boundary context.
"""

import argparse
import hashlib
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort


def convert(source, destination, frames):
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != '429a1beaa91992e88985ddca342170a23feb3b9be1bc54c856422bec3f22474d':
        raise ValueError('Expected the bundled 512-frame fp16 model from 8430989')
    model = onnx.load_from_string(data)
    graph = model.graph
    for tensor in (graph.input[0], graph.output[0]):
        tensor.type.tensor_type.shape.dim[-1].dim_value = frames
    # Recompute intermediate shapes instead of replacing all occurrences of 512:
    # some represent frequency widths, not time.
    del graph.value_info[:]
    short = onnx.shape_inference.infer_shapes(model, strict_mode=True)
    onnx.checker.check_model(short, full_check=True)
    if short.graph.node != graph.node or short.graph.initializer != graph.initializer:
        raise ValueError('Nodes or learned parameters changed')

    result = short.SerializeToString(deterministic=True)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    session = ort.InferenceSession(result, options, providers=['CPUExecutionProvider'])
    x = np.random.default_rng(7).standard_normal((1, 4, 2048, frames), dtype=np.float32)
    y, = session.run(['output'], {'input': x})
    if y.shape != x.shape or y.dtype != x.dtype or not np.isfinite(y).all() or not y.any():
        raise ValueError('Failed float32 inference smoke test')
    destination.write_bytes(result)
    print(f'{destination}: {frames} frames, SHA-256 {hashlib.sha256(result).hexdigest()}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--frames', type=int, choices=(32, 64), default=32)
    args = parser.parse_args()
    convert(args.source, args.destination, args.frames)
