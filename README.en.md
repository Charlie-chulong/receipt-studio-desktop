# Receipt Studio · 小票工坊

[简体中文](README.md) | **English** | [日本語](README.ja.md)

A Windows desktop tool for club order receipts. Enter or paste an order, customize a cute receipt theme and local artwork, review the amount, and export the complete receipt image. End users do not need Node.js or an online editor.

**[Download the latest Windows x64 installer](https://github.com/Charlie-chulong/receipt-studio-desktop/releases/latest)** · [Software license](SOFTWARE_LICENSE.txt) · [Dependency licenses](THIRD_PARTY_NOTICES.txt)

> The links above switch between three documentation languages. The application interface is currently Simplified Chinese; English and Japanese READMEs do not imply localized application interfaces.

![Receipt Studio workbench showing a fictional demonstration order](preview.png)

## Features

- Extract explicit customer details, line totals, a coupon, payment method, and start/completion times from order text. Review the candidate before applying it.
- Customize the names and values of four fields: customer, account/reference number, game/service, and dispatcher.
- Enter start and completion times independently. Blank times are not invented, and existing completion times remain readable in older designs.
- Choose from 10 cute presets: Pastel Journal, Cream Receipt, Strawberry Candy, Mint Candy, Peach Letter, Cream Bear, Cherry Soda, Lemon Soda, Cloud Cotton, and Almond Garden.
- Interface icons are project-specific, AI-generated artwork bundled locally; Lucide is no longer a dependency.
- Customize paper shape, colors, local fonts, logo, background, footer artwork, and sticker position, size, and rotation.
- Calculate line totals, rush fees, discounts, and coupons, with visible calculation steps and configurable application order.
- Autosave the current draft locally, import/export editable JSON designs, and export the full receipt as a 1080-pixel-wide PNG rather than a screenshot of the preview viewport.
- View the fixed author introduction, WeChat contact QR code, and optional Afdian support link.

Changing a preset changes styling, not the order, amounts, or uploaded artwork. Custom field names, times, and assets are saved with the design.

## Download and install

1. Open [Releases](https://github.com/Charlie-chulong/receipt-studio-desktop/releases/latest).
2. Download `Receipt-Studio-1.0.0-Setup.exe`, or the share ZIP containing the installer, documentation in all three languages, and license files.
3. Run the installer on Windows x64, choose an installation directory, and launch “小票工坊”.

The installer includes the runtime. Normal use does not require Node.js, npm, or Git. The first public installer is not code-signed, so Windows may warn about an unknown publisher. Download from this repository's Releases and compare the file hash with `SHA256SUMS.txt`; do not disable security protection to install it.

This release provides a Windows x64 installer only. No macOS, Linux, Windows ARM64, or mobile package is provided.

## Basic workflow

1. Enter an order manually or choose “从订单文字开始” (start from order text).
2. Review the extracted candidate. It replaces the current order only after you confirm.
3. Edit field names in the dashed boxes and enter their values below.
4. Adjust fees and styling, then review the receipt and calculation details.
5. Choose “保存设计” (save design) for an editable JSON file, or “导出 PNG” (export PNG) for a shareable receipt image.

### Order-text example

This is fictional demonstration data, not a real order:

```text
老板：小葵
游戏：三角洲行动
客服：阿梨
开始时间：2026-10-13 12:43
结单时间：2026-10-13 14:43
三角洲护航 2小时 168元
指定陪玩 晚间档 66元
优惠18元
微信支付
```

The expected amount is `168 + 66 - 18 = 216.00` yuan. Each line must end with the **total for that line**, using `元` or a currency symbol. Duration is not multiplied again. A payment method does not establish that payment was received. Ambiguous prices, statuses, or duplicate fields require review. The parser currently recognizes explicit Chinese labels; it is not an AI chat-understanding service.

### Amounts and images

- Amounts use decimal arithmetic with half-up rounding to two decimal places at each calculation stage. Enter a line total, not an hourly unit price or quantity.
- A rush multiplier of `1.2` adds 20% of the original item subtotal.
- The discount input uses the Chinese “折” convention: `10` means no discount, `9` means paying 90% of the base, and `8.5` means paying 85%.
- A coupon cannot exceed its applicable base; invalid amounts are not silently clamped to zero.
- Local PNG, JPG, and WebP images are supported. Remote image URLs and SVG are rejected. Microsoft YaHei is the default font; SimSun and KaiTi may have thinner strokes.

## Local processing and data

Receipt creation, editing, and export work without an internet connection. Order contents, image assets, and design files are processed on the current computer; the application does not upload them to a server.

The current draft is stored in local application data for the current Windows user. Export JSON designs for migration, backups, or separate orders: autosave is not an order-history database or a backup service. A JSON design can contain images and order information, so review it before sharing.

The repository contains the fixed author profile distributed with the application. It does not contain end-user drafts, order files, or local acceptance-test directories. The application does not process payments, hold funds, synchronize orders to the cloud, or issue tax invoices.

## Author and support

Author: **Chu Long (楚龙)**. Club WeChat Mini Program development and a general-purpose Mini Program are available. The author's WeChat QR code is shown in the application's “关于作者” (about the author) page.

[Support the author on Afdian](https://afdian.com/a/chulong). Support is entirely optional and does not affect free use of the application.

## License and third-party rights

This repository makes source code publicly viewable, but **it is not licensed under MIT or another standard open-source license**. Original application code and software distribution are governed by [SOFTWARE_LICENSE.txt](SOFTWARE_LICENSE.txt):

- You may use the original application for free, including receipts for commercial orders.
- You may share the complete, unmodified original installer and share package for free, retaining the license and dependency license texts.
- Reselling, rebranding for resale, or redistribution after removing or obscuring the author introduction and contact QR code is prohibited.
- No open-source reuse or repackaged-redistribution license is granted for original source code. Contact the author for other permissions.

Generated receipt images do not have to include author promotion. Third-party dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt). The David fan-art illustration in the author page involves character rights from *Cyberpunk: Edgerunners*. This project grants no commercial rights to that character or associated marks and does not imply official endorsement or collaboration.

The linked Chinese software license is the authoritative text; this README summarizes it for convenience.

## Run from source

Use only within the permissions granted by the license. Windows x64, a supported Node.js LTS release at version 22.12 or newer, and npm are recommended:

```bash
npm ci
npm test
npm run build
npm run prepare:desktop
npm start
```

Build the Windows installer:

```bash
npm run package:win
```

Output is written to `release/`. The icon in `build/` is generated by a script. `node_modules/`, `dist/`, `release/`, `.smoke/`, and local acceptance screenshots are excluded from Git. Do not commit personal orders, drafts, or credentials.

`npm run dev` starts a browser development preview. It does not provide the full desktop author-profile and native file-save interfaces and is not a replacement for installed-application verification.

## Report a problem

Use this repository's [Issues](https://github.com/Charlie-chulong/receipt-studio-desktop/issues). Include the Windows version, application version, and reproduction steps. Do not attach real customer details, payment QR codes, passwords, or other sensitive information in screenshots, JSON files, or logs.
