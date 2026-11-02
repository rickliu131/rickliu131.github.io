#!/usr/bin/env python3
"""Overlay the selected website on Jekyll's output, preserving existing routes."""
import argparse
from pathlib import Path
import shutil

SITE = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
output = parser.parse_args().output.resolve()
if not output.is_dir() or output == SITE or output == SITE.parent:
    raise SystemExit('Expected an existing Jekyll output directory.')
for name in ('index.html', 'styles.css', 'motion.js'):
    shutil.copyfile(SITE / name, output / name)
for directory in ('assets', 'cv'):
    shutil.copytree(SITE / directory, output / directory, dirs_exist_ok=True)
(output / 'CNAME').write_text('yuxuanliu.me\n')
(output / '.nojekyll').touch()
for section in ('publications', 'news'):
    target = output / section
    target.mkdir(exist_ok=True)
    target.joinpath('index.html').write_text(f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{section.title()} — Yuxuan Liu</title><link rel="canonical" href="https://yuxuanliu.me/#{section}">
<meta http-equiv="refresh" content="0; url=/#{section}"></head>
<body><main><h1>{section.title()}</h1><p><a href="/#{section}">Continue to {section.title()} on Yuxuan Liu’s website</a></p></main></body></html>\n''')
(output / '404.html').write_text('''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Page not found — Yuxuan Liu</title><link rel="stylesheet" href="/styles.css"></head>
<body><a class="skip-link" href="#main">Skip to main content</a><div class="shell">
<header class="site-header"><a class="site-name" href="/">Yuxuan Liu</a><nav aria-label="Main navigation"><ul role="list"><li><a href="/">Home</a></li><li><a href="/#publications">Publications</a></li></ul></nav></header>
<main id="main" tabindex="-1" style="padding-block:52px"><h1>Page not found</h1><p>The page may have moved. <a href="/">Return to the homepage</a> or <a href="/#publications">browse publications</a>.</p></main>
</div></body></html>\n''')
print(f'Packaged the personal website in {output}; existing pages and assets preserved.')
