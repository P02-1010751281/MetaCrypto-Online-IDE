# MetaCrypto Online IDE · Schrödinger's Cat Editor

> [中文](./README.zh-CN.md)

🐱 A visual programming platform for post-quantum cryptography — built on Blockly and Vue 3.

> **v2.0.0 update**: the block core, both code generators (Python / JavaScript) and the standalone editor implementation. Published under the title *MetaCrypto online* (*SoftwareX* 35 (2026) 102943). Sources, lineage, team and licence: [PROVENANCE.md](PROVENANCE.md).

> "The cat is both alive and dead until you open the box.  
> Your cipher is both secure and broken until you audit the code."

## Features

- 🔮 **Post-quantum cryptography** — lattice-focused components and algorithm stages such as NTT/INTT, encode/compress, and SampleNTT
- 🔐 **Crypto teaching coverage** — AES/SM4 rounds and block modes, S-Box and bitwise operations, hash functions (SM3/SHA/HMAC) and number-theoretic operations
- 🧮 **Algorithm templates** — 29 pre-filled teaching starter templates; parameters or algorithm steps still have to be completed as annotated after dragging them out
- ✅ **Vector and regression checks** — function templates receive structural/executability checks and 60 demos have registered output regressions in both JavaScript and Python; selected cases such as SM4/SM3/SM2/ML-KEM are checked against standard vectors, which is not an algorithm certification
- 🧩 **Visual programming** — drag and drop blocks to write crypto code like building with LEGO
- 🌐 **Multilingual** — Chinese/English UI, Blockly blocks switch in sync
- 💻 **Code generation** — generate executable JavaScript / Python code in one click
- 📁 **Project management** — multi-project local management based on IndexedDB, with auto-save
- 🖥️ **Desktop app** — Tauri wrapper, runs natively on Windows / Linux / macOS
- 📱 **Responsive** — adapts to wide and narrow screens, panels resizable by dragging

## Quick Start

New users: start with the [setup and acceptance guide](docs/guides/SETUP.en.md), [user guide](docs/guides/USER-GUIDE.en.md), [capability map](docs/guides/CAPABILITY-MAP.en.md), and [demo index](demos/README.en.md).

```bash
# Install dependencies
npm ci

# Start the development server
npm run dev          # → http://localhost:3001

# Build the production bundle
npm run build
npm run build:check-bundle

# Tauri desktop app
npm run tauri:dev    # development mode
npm run tauri:build  # package

# Quality gates
npm run test:unit
npm run standards:check
npm run standards:split-check
npm run standards:formula-check
npm run standards:inventory
# Regenerate the entry-by-entry source inventory when source metadata changes:
# npm run standards:inventory:write
npm run cycles:check

# Regression gates
npm run lint:check
npm run type-check
npm run docs:titles:check
npm run build-guide:check
npm run verify:all
npm run docs:check-links
```

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend framework | Vue 3 (Composition API + TypeScript) |
| Visual programming | Blockly 13.2.x |
| Code highlighting | highlight.js |
| Docs rendering | marked + mermaid |
| Desktop wrapper | Tauri 2.x |
| Build tooling | Vite + vue-tsc |
| Code standards | ESLint 10.x |
| Local storage | Browser IndexedDB |

## Project Structure

```text
src/
├── App.vue                     # Main editor view
├── main.ts                     # Application entry
├── router/                     # Routes (editor + docs + project management)
├── views/                      # Page views (ProjectList / DocsView)
├── blocks/                     # Blockly block definitions (grouped by category)
│   ├── ctrl/ data/ array/ logic/ bitwise/ sbox/ hash/
│   ├── symmetric/ numtheory/ ecc/ post-quantum/
│   ├── procedure/              # Function templates + Blockly native procedure overrides
│   └── remaining.ts            # Math primitives + HMAC + encoding utilities
├── generators/                 # Code generators
│   ├── javascript/             # JavaScript generation
│   └── python/                 # Python generation
├── composables/                # Vue Composables
│   ├── locale.ts               # Internationalization (zh/en)
│   ├── generator.ts            # Code generation logic
│   ├── useEditorProject.ts     # Project management
│   └── useProjectDB.ts         # IndexedDB operations
├── constants/                  # Constant configuration
│   ├── block-types.ts          # Type system
│   ├── code-languages.ts       # Supported languages
│   └── workspace-config.ts     # Blockly workspace configuration
├── components/                 # Shared components
│   ├── BlocklyEditor.vue       # Blockly editor component
│   ├── CodePreviewer.vue       # Code previewer
│   └── CryptoFunctionPanel.vue # Function template management panel
├── utils/                      # Utility functions (toolbox-config / migration / markdown)
├── styles/                     # Global styles / CSS variables
└── assets/                     # Static assets
docs/                           # Documentation (guides/ core + blocks/ index + demos/ + 40 standards directories + papers/ index)
demos/                          # Blockly workspace examples (with official-vector expectations)
```

## Supported Crypto Modules (224 custom blocks, 17 toolbox categories)

| Category | Representative capabilities |
|------|--------|
| Control flow | Iteration and Blockly control composition |
| Data and conversion | Byte/seed inputs, lengths, type conversion, Base64/Hex and endianness |
| Bitwise | Logic, shifts, rotates, substitution and expressions |
| S-Box | Custom S-box plus AES/SM4/ZUC presets |
| Hashing and padding | SHA-2, SHA-3, SHAKE, SM3, HMAC, KDF and DRBG |
| Symmetric cryptography | AES, SM4, block modes, CMAC/CCM/GCM/XTS and Ascon |
| Number theory and KDF | NTT, GF(2^m), polynomials, RSA and related primitives |
| Elliptic curves and public-key cryptography | ECDH, X25519, ECDSA, EdDSA, SM2 and SM9 |
| Stream ciphers | ZUC state transformations, keystream and EEA3 components |
| Post-quantum cryptography | ML-KEM/ML-DSA lattice components and stages; SLH-DSA and code-based teaching components |
| Functions and Blockly-native categories | 29 function-template registrations and native variables, math, arrays and logic |

> The authoritative total is 224 active custom block types after recursively expanding and deduplicating `ALL_BLOCK_TYPES` in `src/blocks/index.ts`. There are 29 function-template registrations: three base `crypto_*` blocks are already included in the 224, while 26 `proc_*` templates are additional types. The deduplicated union contains 250 types. One further identity, `ctrl_assign`, is registered only so legacy workspaces still load: it is absent from the toolbox and excluded from both 224 and 250. The 17 toolbox categories include four Blockly-native categories. The table describes scope, not additive category counts; the counting rules are recorded in [`docs/standards/CONFORMANCE-INVENTORY.md`](docs/standards/CONFORMANCE-INVENTORY.md) and guarded by `npm run verify:templates`, which enumerates every registered type; these four counts follow the main branch, so historical versions should be read from the inventory inside that version's tree (the `v2.0.0` tag tree records 222 active blocks and 248 types after merging). This educational surface is not a CAVP/ACVTS, CMVP/FIPS 140-3 or formal-verification claim.

The browser is for Blockly editing, code generation and user trials. Trusted randomness assessment, statistical testing, isolated execution and final reports belong to the `metacrypt_server` backend.

## Code Generation Example

Drag blocks → generate executable code in one click, using the Kyber (FIPS 203) NTT post-quantum primitive as an example:

### Python

```python
def ntt(a, q=3329, n=256):
    """FIPS 203 Cooley-Tukey NTT with bit-reversed zetas (Algorithm 6)"""
    gen = 17 if q == 3329 else 3
    res = list(a)
    ln = len(res)
    def _brv(x, bits):
        r = 0
        for _ in range(bits):
            r = (r << 1) | (x & 1)
            x >>= 1
        return r
    nbits = n.bit_length() - 1
    stride = ln // 2
    zz = 0
    while stride >= 2:  # FIPS 203 Alg 6: for(len=128; len>=2; len>>=1)
        for start in range(0, ln, stride * 2):
            zz += 1
            zp = pow(gen, _brv(zz, nbits - 1), q)
            for i in range(start, start + stride):
                u = res[i]
                t = (zp * res[i + stride]) % q
                res[i] = (u + t) % q
                res[i + stride] = (u - t + q) % q
        stride >>= 1
    return res

# Pointwise multiplication in the NTT domain
result = ntt_mul(ntt_a, ntt_b, q=3329)
```

### JavaScript

```javascript
function ntt(a, q = 3329, n = 256) {
    const gen = (q === 3329) ? 17 : 3;
    const res = a.slice();
    const len = res.length;
    const brv = (x, bits) => {
        let r = 0;
        for (let i = 0; i < bits; i++) { r = (r << 1) | (x & 1); x >>= 1; }
        return r;
    };
    const nbits = Math.log2(n) | 0;
    let stride = len / 2;
    let zz = 0;
    while (stride >= 2) {  // FIPS 203 Alg 6: for(len=128; len>=2; len>>=1)
        for (let start = 0; start < len; start += stride * 2) {
            zz++;
            const zp = modPow(gen, brv(zz, nbits - 1), q);
            for (let i = start; i < start + stride; i++) {
                const u = res[i];
                const t = (zp * Number(res[i + stride])) % q;
                res[i] = (u + t) % q;
                res[i + stride] = (u - t + q) % q;
            }
        }
        stride >>= 1;
    }
    return res;
}
```

## Version and citation

- **Version**: 2.0.0 (repository tag [`v2.0.0`](https://github.com/P02-1010751281/MetaCrypto-Online-IDE/tree/v2.0.0), matching `version` in `package.json`)
- **Desktop executable**: `metacrypto-online-ide` (see `mainBinaryName` in [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json))
- **Related article**: L. Zhang, T. Luo, T. Ding, C. Xiao, J. Wang, "MetaCrypto online: A model-driven visual development platform for cryptographic engineering," *SoftwareX* 35 (2026) 102943, <https://doi.org/10.1016/j.softx.2026.102943>
- **Software deposit (reproducible capsule)**: to be recorded here once the Zenodo record for v2.0.0 exists

## License

[AGPL-3.0-or-later](LICENSE)
