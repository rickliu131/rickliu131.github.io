#!/usr/bin/env python3
"""Import original-site content and write this independent, static preview.

Uses Python's standard library only. The original Jekyll repository is read-only.
"""

import argparse
import datetime
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = Path.home() / "Desktop/rickliu131.github.io"


def escape(value):
    return html.escape(str(value), quote=True)


def frontmatter(path):
    text = path.read_text(encoding="utf-8")
    parts = text.split("---", 2)
    if len(parts) != 3:
        raise ValueError(f"Expected front matter in {path}")
    return parts[1], parts[2].strip()


def yaml_value(text, key, default=""):
    match = re.search(rf"^[ \t]*{re.escape(key)}:[ \t]*([^\n]*)", text, re.MULTILINE)
    if not match:
        return default
    value = match.group(1).strip()
    if value.startswith(('"', "'")) and value[-1:] == value[0]:
        return value[1:-1]
    value = value.split(" #", 1)[0].strip()
    return default if value.lower() in ("null", "~", "") else value


def inline_markdown(text):
    """Render the source's plain text and inline links without raw HTML."""
    output, start = [], 0
    for match in re.finditer(r"\[([^\]]+)\]\(([^)]+)\)", text):
        output.append(escape(text[start:match.start()]))
        output.append(f'<a href="{escape(match[2])}">{escape(match[1])}</a>')
        start = match.end()
    output.append(escape(text[start:]))
    return "".join(output)


def braced(text, start):
    if text[start] != "{":
        raise ValueError("Expected a braced BibTeX value")
    depth = 1
    cursor = start + 1
    while cursor < len(text):
        char = text[cursor]
        if char == "\\":
            cursor += 2
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start + 1:cursor], cursor + 1
        cursor += 1
    raise ValueError("Unclosed BibTeX value")


def bibliography(path):
    """Read braced entries used by the source bibliography, preserving prose."""
    text = path.read_text(encoding="utf-8")
    papers = []
    cursor = 0
    while match := re.search(r"@(\w+)\s*\{", text[cursor:]):
        opening = cursor + match.end() - 1
        body, cursor = braced(text, opening)
        identifier, fields = body.split(",", 1)
        paper = {"id": identifier.strip(), "type": match[1].lower()}
        position = 0
        while field := re.search(r"(\w+)\s*=\s*", fields[position:]):
            start = position + field.end()
            if fields[start] != "{":
                raise ValueError(f"Unsupported BibTeX field syntax in {identifier}")
            value, position = braced(fields, start)
            paper[field[1].lower()] = value
        if paper.get("selected", "").lower() == "true":
            papers.append(paper)
    return sorted(papers, key=lambda paper: int(paper["year"]), reverse=True)


class SourceLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a" and "profile-link" in attrs.get("class", "").split():
            href = attrs["href"]
            label = href[7:] if href.startswith("mailto:") else attrs["aria-label"]
            self.links.append({"label": label, "href": href})


def copy_asset(source, directory, name=None):
    destination = ROOT / "assets" / directory / (name or source.name)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    return destination.relative_to(ROOT).as_posix()


def source_content(source):
    config = (source / "_config.yml").read_text(encoding="utf-8")
    about_meta, about = frontmatter(source / "_pages/about.md")
    name = " ".join(filter(None, [yaml_value(config, key) for key in ("first_name", "middle_name", "last_name")]))
    links = SourceLinks()
    links.feed(about_meta)
    profile_links = sorted(links.links, key=lambda link: not link["href"].startswith("mailto:"))
    image_path = source / "assets/img" / yaml_value(about_meta, "image")
    content = {
        "name": name,
        "biography": about.split("\n\n"),
        "profile_links": profile_links,
        "portrait": {"src": copy_asset(image_path, "images", "yuxuan-liu.jpg"), "alt": yaml_value(about_meta, "image_alt")},
        "news": [],
        "publications": [],
    }
    for path in sorted((source / "_news").glob("*.md")):
        metadata, body = frontmatter(path)
        if yaml_value(metadata, "inline") == "true":
            date = yaml_value(metadata, "date")[:10]
            datetime.date.fromisoformat(date)
            content["news"].append({"date": date, "text": body})
    content["news"].sort(key=lambda item: item["date"], reverse=True)

    for entry in bibliography(source / "_bibliography/papers.bib"):
        paper = dict(entry)
        paper["authors"] = []
        for author in entry["author"].split(" and "):
            family, given = author.split(",", 1)
            paper["authors"].append(f"{given.strip()} {family.strip()}")
        paper["venue"] = entry.get("journal", entry.get("booktitle", ""))
        original_image = source / "assets/img/publication_preview" / entry["preview"]
        paper["image"] = {"src": copy_asset(original_image, "images"), "alt": entry["alt_text"]}
        paper["resources"] = []
        for field, label in (("pdf", "Paper"), ("html", "Web"), ("video", "Video")):
            if field not in entry or (field == "html" and entry["id"] == "general_accessibility_models_demo"):
                continue
            destination = entry[field]
            if field == "pdf" and not re.match(r"https?://", destination):
                destination = copy_asset(source / "assets/pdf" / destination, "papers")
            paper["resources"].append({"label": label, "href": destination})
        if entry["id"] == "general_accessibility_models_demo":
            paper["resources"].append({"label": "Demo Abstract", "href": "assets/papers/gam-uist-2026.pdf"})
        paper["resources"].sort(key=lambda link: {"Paper": 0, "Demo Abstract": 0, "Web": 1, "Video": 2}[link["label"]])
        content["publications"].append(paper)
    overrides = json.loads((ROOT / "content-overrides.json").read_text(encoding="utf-8"))
    content.update(overrides)
    for paper in content["publications"]:
        paper["title"] = overrides.get("publication_titles", {}).get(paper["id"], paper["title"])
    content["cv"] = copy_asset(source / "_cv/cv.pdf", "documents", "yuxuan-liu-cv.pdf")
    return content


TROPHY = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 3h8v7a4 4 0 0 1-8 0V3Z M8 5H4v3a4 4 0 0 0 4 4 M16 5h4v3a4 4 0 0 1-4 4 M12 14v5 M8 21h8 M10 19h4"/></svg>'


def paper_html(paper, name):
    authors = [f'<strong>{escape(author)}</strong>' if author == name else escape(author) for author in paper["authors"]]
    author_text = ", ".join(authors[:-1]) + ", and " + authors[-1] if len(authors) > 1 else authors[0]
    title = escape(paper["title"])
    primary_link = paper["resources"][0]["href"]
    primary_type = ' type="application/pdf"' if paper["resources"][0]["label"] in ("Paper", "Demo Abstract") else ""
    primary_hint = ' aria-describedby="pdf-format-description"' if primary_type else ""
    resources = []
    for link in paper["resources"]:
        media_type = ' type="application/pdf"' if link['label'] in ('Paper', 'Demo Abstract') else ''
        format_hint = " (PDF)" if media_type else ""
        resources.append(f'<li><a href="{escape(link["href"])}"{media_type}>{link["label"]}<span class="sr-only"> for {title}{format_hint}</span></a></li>')
    resources = "\n".join(resources)
    award = f'<p class="award">{TROPHY}<span>{escape(paper["award_name"].replace("🏆", "").strip())}</span></p>' if paper.get("award_name") else ""
    fill = " paper-image-fill" if paper['id'] in ('handproxy', 'worldscribe') else ""
    image_src = paper['image']['src']
    motion = ""
    control = ""
    if paper['id'] == 'worldscribe':
        motion = f' data-animation="{escape(image_src)}" data-poster="assets/images/worldscribe-poster.png" id="worldscribe-animation"'
        image_src = 'assets/images/worldscribe-poster.png'
        control = ('<button class="motion-toggle" type="button" aria-controls="worldscribe-animation" '
                   'aria-label="Play animation for WorldScribe" title="Play animation" hidden>'
                   '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
                   '<path class="motion-play" d="m8 5 11 7-11 7Z"/>'
                   '<path class="motion-pause" d="M6 5h4v14H6zM14 5h4v14h-4z"/>'
                   '</svg></button>')
    return f'''
        <li>
          <article class="paper" aria-label="{title}">
            <figure class="paper-figure">
              <a class="figure-link" href="{escape(paper['image']['src'])}" aria-label="View full figure for {title}">
                <img class="paper-image{fill}" src="{escape(image_src)}"{motion} alt="{escape(paper['image']['alt'])}" width="208" height="139" loading="lazy" decoding="async">
              </a>
              {control}
            </figure>
            <div class="paper-copy">
              <h3 id="{paper['id']}-title"><a href="{escape(primary_link)}"{primary_type}{primary_hint}>{title}</a></h3>
              <p class="authors">{author_text}</p>
              <p class="venue">{escape(paper['venue'])}</p>
              {award}
              <ul class="paper-links" aria-label="Resources for {title}" role="list">{resources}</ul>
              <details>
                <summary><span class="summary-text">Abstract</span><span class="sr-only"> for {title}</span></summary>
                <p class="abstract-text">{escape(paper['abstract'])}</p>
              </details>
            </div>
          </article>
        </li>'''


def render(content):
    name = escape(content["name"])
    biography = "\n".join(f'<p>{inline_markdown(paragraph)}</p>' for paragraph in content["biography"])
    brand_icons = {"X (Twitter)": "x.png", "LinkedIn": "linkedin.png", "Google Scholar": "google-scholar.ico"}
    contacts = []
    for link in content["profile_links"]:
        if link["href"].startswith("mailto:"):
            icon = '<svg class="email-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></svg>'
        else:
            icon = f'<img class="brand-icon" src="assets/icons/{brand_icons[link["label"]]}" alt="" width="21" height="21" aria-hidden="true">'
        contacts.append(f'<li><a href="{escape(link["href"])}" aria-label="{escape(link["label"])}" title="{escape(link["label"])}">{icon}</a></li>')
    contacts = "\n".join(contacts)
    news = []
    for item in content["news"]:
        display_date = datetime.date.fromisoformat(item["date"]).strftime("%b %d, %Y")
        news.append(f'<li class="news-item"><time class="news-date" datetime="{item["date"]}">{display_date}</time><p class="news-copy">{inline_markdown(item["text"])}</p></li>')
    papers = "\n".join(paper_html(paper, content["name"]) for paper in content["publications"])
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Yuxuan Liu is a PhD student at Michigan CSE studying human–computer interaction and accessibility.">
  <link rel="canonical" href="https://yuxuanliu.me/">
  <meta name="theme-color" content="#fcfcfa">
  <title>{name}</title>
  <link rel="icon" href="assets/favicon.svg?v=original" type="image/svg+xml">
  <link rel="stylesheet" href="styles.css">
  <script src="motion.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to main content</a>
  <div class="shell">
    <header class="site-header">
      <a class="site-name" href="#about">{name}</a>
      <nav aria-label="Main navigation">
        <ul role="list"><li><a href="#about">About</a></li><li><a href="#news">News</a></li><li><a href="#publications">Publications</a></li><li><a href="cv/">CV</a></li></ul>
      </nav>
    </header>
    <main id="main" tabindex="-1">
      <section class="profile" id="about" aria-labelledby="name" tabindex="-1">
        <div class="profile-copy">
          <h1 class="sr-only" id="name">{name}</h1>
          <div class="bio">{biography}</div>
        </div>
        <div class="profile-photo">
        <img class="portrait" src="{escape(content['portrait']['src'])}" alt="{escape(content['portrait']['alt'])}" width="192" height="224" fetchpriority="high">
          <ul class="profile-links" aria-label="Contact and social profiles" role="list">{contacts}</ul>
        </div>
      </section>
      <section class="news" id="news" aria-labelledby="news-heading" tabindex="-1">
        <h2 id="news-heading">News</h2>
        <ul class="news-list" role="list">{''.join(news)}</ul>
      </section>
      <section class="publications" id="publications" aria-labelledby="publications-heading" tabindex="-1">
        <h2 id="publications-heading">Publications</h2>
        <ol class="publication-list" role="list">{papers}</ol>
      </section>
    </main>
    <span id="pdf-format-description" hidden>PDF document</span>
    <footer class="site-footer"><p>© 2026 {name}</p></footer>
  </div>
</body>
</html>
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="Original Jekyll checkout (read-only).")
    args = parser.parse_args()
    from build_cv import build_cv

    source = args.source.resolve()
    content = source_content(source)
    build_cv(source)
    (ROOT / "content.json").write_text(json.dumps(content, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (ROOT / "index.html").write_text("\n".join(line.rstrip() for line in render(content).splitlines()) + "\n", encoding="utf-8")
    print(f"Built static preview with {len(content['news'])} news items and {len(content['publications'])} publications.")


if __name__ == "__main__":
    main()
