# Admin form label and header polish

- Fixed `Provider model ID` and other long labels wrapping in the fixed label column.
- Increased the label column to 128px and set labels to `white-space: nowrap` on desktop.
- At <=560px labels stack above controls with left alignment, and hints/errors return to a single column.
- Compacted the header token form at 821-1100px so the top bar does not wrap.
- Prevented table captions from wrapping at narrow desktop widths.
- Verified at 826px and 938px, plus 390px mobile; no horizontal overflow.
