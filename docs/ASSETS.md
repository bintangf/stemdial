# Assets

## src/separator/model/vocals.onnx

Vocal complex-spectrogram model for Kuielab MDX-Net (TFC-TDF-U-Net, 44.1 kHz,
FFT 5120, streaming hop 1024). Distributed by the Ultimate Vocal Remover (UVR) model
collection. Original file name `kuielab_a_vocals.onnx`.

- Official weights: https://zenodo.org/records/5717356 (`onnx_A.zip`)
- Mirror used for the original download: https://huggingface.co/Politrees/UVR_resources/resolve/main/models/MDXNet/kuielab_a_vocals.onnx
- Original fp32 SHA-256: `daba83c2ee1afee9139766ad64c9b6808d6b6f092fff04bed3338be50baac721`
- Original 512-frame fp16 SHA-256: `429a1beaa91992e88985ddca342170a23feb3b9be1bc54c856422bec3f22474d`
- Streaming 32-frame fp16 SHA-256: `5e35c525d41c0db69499c96473e4121634b3ecc3145d94b6a466400d13922ca9` (rebuild with `tools/shorten_mdx.py`).
- License: CC BY 4.0. The Zenodo record lists CC BY 4.0 for the KUIELab-MDX-Net
  weights, and the bundled model came from that archive: its fp32 SHA-256
  matches `onnx_A/vocals.onnx` byte for byte.

fp16 conversion (halves inference time on Apple Silicon, keeps float32 I/O):

```python
import onnx
from onnxconverter_common import float16
onnx.save(float16.convert_float_to_float16(onnx.load('kuielab_a_vocals.onnx'), keep_io_types=True), 'vocals.onnx')
```

Streaming contract: input float32 `[1,4,2048,32]` (`L re, L im, R re, R im`;
2048 positive bins, 32 frames), output the same shape = vocal spectrogram.
Instrumental is the original minus vocals.

## src/separator/ort/

onnxruntime-web 1.23.2, MIT (see `src/separator/ort/LICENSE`). Files copied verbatim from
the npm package `dist/`. The engine imports `ort.webgpu.min.mjs` and loads the
asyncify wasm pair through `ort.env.wasm.wasmPaths`. The jsep pair and
`ort.min.mjs` are not bundled because nothing loads them. No CDN at runtime.

- Package: https://www.npmjs.com/package/onnxruntime-web/v/1.23.2
- Source: https://github.com/microsoft/onnxruntime
