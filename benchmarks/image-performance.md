# Optimization performance

Measured with `pnpm bench` on 2026-11-19 in chromium (Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.33 Safari/537.36).
Inputs are generated (photo-like images with noise, documents embedding them, text logs) so results are
reproducible; real-world content usually compresses differently. Times are the median of 3 runs of
`optimizeFile`. Hardware-dependent: re-run locally.

| Case | Engine | Input | Output | Saved | Target met | Median time |
| --- | --- | --- | --- | --- | --- | --- |
| Phone photo (12 MP JPEG) → 2 MB limit | image | 20.34 MB | 1.93 MB (jpeg) | 90.5% | yes | 806 ms |
| Phone photo (12 MP JPEG) → 1 MB limit | image | 20.34 MB | 1.00 MB (jpeg) | 95.1% | yes | 811 ms |
| Retina screenshot (PNG → WebP) → 1 MB limit | image | 5.00 MB | 0.98 MB (webp) | 80.4% | yes | 3,449 ms |
| 4-page PDF with photos | pdf | 28.84 MB | 1.55 MB (pdf) | 94.6% | — | 430 ms |
| DOCX with 3 photos | document | 30.03 MB | 1.82 MB (vnd.openxmlformats-officedocument.wordprocessingml.document) | 93.9% | — | 615 ms |
| ZIP of text logs (stored → deflate) | archive | 2.77 MB | 0.29 MB (zip) | 89.5% | — | 59 ms |
