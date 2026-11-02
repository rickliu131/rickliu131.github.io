#!/usr/bin/env python3
"""Build semantic HTML from the CV's supported LaTeX subset, without changing prose."""
from pathlib import Path
import argparse
import html
import re

SITE = Path(__file__).resolve().parents[1]


def group(text, start):
    if text[start] != '{':
        raise ValueError('Expected a LaTeX argument')
    depth, cursor = 1, start + 1
    while cursor < len(text):
        if text[cursor] == '\\':
            cursor += 2
            continue
        if text[cursor] == '{': depth += 1
        if text[cursor] == '}':
            depth -= 1
            if not depth: return text[start+1:cursor], cursor+1
        cursor += 1
    raise ValueError('Unclosed LaTeX argument')


def inline(text):
    """Render only the commands used for CV prose; reject unsupported commands."""
    text = re.sub(r'\s+', ' ', text).strip()
    text = text.replace('---', '—').replace('--', '–').replace('``', '“').replace("''", '”')
    text = re.sub(r"(?<=\w)'(?=\w)", '’', text)
    output, i = [], 0
    while i < len(text):
        if text[i] != '\\':
            output.append(html.escape(text[i])); i += 1; continue
        i += 1
        if i >= len(text): raise ValueError('Incomplete LaTeX command')
        char = text[i]
        if char in '&%_# ':
            output.append(html.escape(char)); i += 1; continue
        if char == '\\':
            output.append('<br>'); i += 1; continue
        match = re.match(r'[A-Za-z]+', text[i:])
        if not match: raise ValueError(f'Unsupported LaTeX escape: {text[i:]}')
        command = match[0]; i += len(command)
        if command == 'me': output.append('<strong>Yuxuan Liu</strong>'); continue
        if command == 'ae': output.append('æ'); continue
        if command in ('par', 'nobreak', 'footnotesize'):
            continue
        if command in ('textbf','textit','venue','award','href','vspace'):
            while i < len(text) and text[i].isspace(): i += 1
            value, i = group(text, i)
            if command == 'href':
                while i < len(text) and text[i].isspace(): i += 1
                label, i = group(text, i)
                output.append(f'<a href="{html.escape(value, quote=True)}">{inline(label)}</a>')
            elif command == 'vspace': continue
            elif command == 'textbf': output.append(f'<strong>{inline(value)}</strong>')
            elif command == 'textit': output.append(f'<em>{inline(value)}</em>')
            elif command == 'venue': output.append(f'<strong class="venue">{inline(value)}</strong>')
            else: output.append(f'<br><strong>{inline(value)}</strong>')
            continue
        raise ValueError(f'Unsupported CV command: {command}')
    return ''.join(output)


def blocks(text):
    output, cursor = [], 0
    for match in re.finditer(r'\\(entry|pub)\{', text):
        if match.start() < cursor: continue
        before = text[cursor:match.start()].strip()
        if before and inline(before).strip(): output.append(f'<p>{inline(before)}</p>')
        label, end = group(text, match.end()-1)
        while end < len(text) and text[end].isspace(): end += 1
        body, cursor = group(text, end)
        kind = match[1]
        label_html = f'[{inline(label)}]' if kind == 'pub' else inline(label).replace('<br>', '<br class="date-break"> ')
        output.append(f'<div class="cv-entry {kind}"><div class="entry-label">{label_html}</div><p class="entry-body">{inline(body)}</p></div>')
    rest = text[cursor:].strip()
    if rest and inline(rest).strip(): output.append(f'<p>{inline(rest)}</p>')
    return '\n'.join(output)


def build_cv(source: Path):
    source = Path(source)
    if source.is_dir(): source = source / '_cv/cv.tex'
    tex = re.sub(r'(?<!\\)%[^\n]*', '', source.read_text(encoding='utf-8'))
    body = tex.split(r'\begin{document}',1)[1].split(r'\end{document}',1)[0]
    last_updated = re.search(r'\\begin\{center\}\\footnotesize\s+(.*?)\\end\{center\}', body, re.S)
    if not last_updated: raise ValueError('Missing last-updated line')
    updated = inline(last_updated[1])
    body = body[:last_updated.start()]
    body = re.sub(r'\\vspace\{4ex\}\s*$', '', body)
    sections = list(re.finditer(r'\\section\{([^}]+)\}',body))
    if len(sections) != 9: raise ValueError('CV structure changed; review HTML pagination.')
    header = body[:sections[0].start()]
    name = re.search(r'\\textbf\{([^}]+)\}',header)[1]
    minipages = re.findall(r'\\begin\{minipage\}\[t\]\{[^}]+\}(.*?)\\end\{minipage\}',header,re.S)
    if len(minipages) != 2: raise ValueError('Unexpected CV contact header')
    affiliation = inline(minipages[0]); contact = inline(minipages[1].replace(r'\raggedleft',''))
    rendered, toc = [], []
    for i, section in enumerate(sections):
        title = section[1]
        slug = re.sub(r'[^a-z0-9]+','-',title.lower()).strip('-')
        text = body[section.end():sections[i+1].start() if i+1 < len(sections) else len(body)].strip()
        if title == 'Service':
            roles = list(re.finditer(r'\\textbf\{([^}]+)\}(?:\\\\|\\par\\nobreak)', text))
            content = []
            for j, role in enumerate(roles):
                role_slug = slug+'-'+re.sub(r'[^a-z0-9]+','-',role[1].lower())
                prose = text[role.end():roles[j+1].start() if j+1 < len(roles) else len(text)]
                content.append(f'<div class="service-role"><h3 id="{role_slug}">{html.escape(role[1])}</h3>{blocks(prose)}</div>')
            section_body = '\n'.join(content)
        else: section_body = blocks(text)
        rendered.append((title,f'<section class="cv-section" aria-labelledby="{slug}"><h2 id="{slug}" tabindex="-1">{html.escape(title)}</h2>{section_body}</section>'))
        toc.append(f'<li><a href="#{slug}">{html.escape(title)}</a></li>')
    first = '\n'.join(markup for title, markup in rendered[:5])
    second = '\n'.join(markup for title, markup in rendered[5:])
    footer = lambda page: f'<p class="page-footer" aria-hidden="true"><strong>{html.escape(name)}</strong> — <em>curriculum vitæ</em>, page {page}</p>'
    page = f'''<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(name)} — Curriculum Vitae</title>
<meta name="description" content="Curriculum vitae of Yuxuan Liu, Computer Science and Engineering, University of Michigan.">
<link rel="icon" href="../assets/favicon.svg?v=original" type="image/svg+xml">
<link rel="stylesheet" href="cv.css">
<link rel="preload" href="../assets/fonts/LibertinusSerif-Regular.otf" as="font" type="font/otf" crossorigin>
</head>
<body>
<a class="skip-link" href="#cv-content">Skip to curriculum vitae</a>
<nav class="cv-tools" aria-label="CV navigation"><a href="../">Back to website</a><a href="../assets/documents/yuxuan-liu-cv.pdf" type="application/pdf">Download PDF</a><details><summary>Jump to section</summary><ul role="list">{''.join(toc)}</ul></details></nav>
<main id="cv-content" tabindex="-1" aria-labelledby="cv-title">
<div class="cv-page" data-page="1">
<header class="cv-header"><h1 id="cv-title"><strong>{html.escape(name)}</strong><span>Curriculum Vitæ</span></h1>
<div class="contact-header"><p>{affiliation}</p><p class="contact-links">{contact}</p></div></header>
{first}
{footer(1)}
</div>
<div class="cv-page" data-page="2">
{second}
<p class="updated">{updated}</p>
{footer(2)}
</div>
</main>
</body></html>
'''
    output = SITE/'cv'; output.mkdir(exist_ok=True)
    (output/'index.html').write_text('\n'.join(line.rstrip() for line in page.splitlines())+'\n',encoding='utf-8')
    return output/'index.html'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,default=SITE.parent)
    print(build_cv(parser.parse_args().source))
