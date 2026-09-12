# Nosana / ComfyUI workflow

The bundled `monster-api.json` was verified on Nosana on 2026-09-12: ComfyUI 0.33.3, RTX 4060 Ti, `v1-5-pruned-emaonly.safetensors`, 512×512, 20 Euler steps. One smoke run returned all three images in 18.0 seconds. The GPU was then stopped. Reuse this workflow on a deployment with the same checkpoint, or export a successful workflow in **API format**.

The bundled `workflow-map.json` points to text nodes 6/7, sampler 3, and output 9. For another workflow, map its actual node IDs:

```json
{"positive":["YOUR_TEXT_NODE"],"negative":["YOUR_NEGATIVE_TEXT_NODE"],"seed":["YOUR_SAMPLER_NODE"],"output":"YOUR_SAVE_IMAGE_NODE"}
```

This adapter supports text nodes with `inputs.text`, samplers with `inputs.seed`, and SaveImage-style output. If your workflow uses `noise_seed` or custom input names, adapt the mapping code to that verified workflow. An empty `negative` array is valid. Do not use paid external API nodes when demonstrating GPU computation on Nosana.

Set `COMFY_BASE_URL`, the optional deployment-specific authentication header, and `IMAGE_PROVIDER=nosana` in `.env`. Run `npm run smoke:gpu`. Then verify all three images are copied to `data/assets`. A POST with an unknown result is never automatically submitted twice.

Sources: [Nosana deployment guide](https://learn.nosana.com/deployments/my-first-deployment.html), [ComfyUI server routes](https://docs.comfy.org/development/comfyui-server/comms_routes).

## 日本語

Nosanaで生成に成功したワークフローをAPI形式で`monster-api.json`へ保存してください。`workflow-map.json`には実際のノードIDを設定します。テキストは`inputs.text`、シードは`inputs.seed`、出力はSaveImage形式に対応します。カスタム形式は実際のワークフローに合わせて変更してください。接続設定後に`npm run smoke:gpu`で3画像の取得を確認します。
