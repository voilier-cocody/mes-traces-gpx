#!/usr/bin/env python3
"""Transforme un article Blogspot ancien vers le nouveau format du blog.

Usage :
    python3 transform_blogspot.py article.html                # affiche le résultat
    python3 transform_blogspot.py article.html -o propre.html # écrit dans un fichier

Règles appliquées :
- les blocs <script> et <style> sont conservés tels quels en tête d'article
- les tags div, a, br, table, span... sont supprimés
- tous les textes deviennent des paragraphes <p>
- les liens autour des images sont supprimés (plus de lien sur les images)
- les images sont nettoyées (sans width/height/border/style) et reçoivent
  la class "galerie-item" ; la légende d'une image (cellule tr-caption)
  est restituée en paragraphe <p> sous la galerie
- les images consécutives sont regroupées dans <div class="galerie-grille">
- les iframes YouTube sont normalisées dans <div class="video-container">
"""

import argparse
import html
import re
import sys
from html.parser import HTMLParser

SELF_CLOSING = {"br", "img", "meta", "link", "input", "hr"}

VIDEO_IFRAME = (
    '  <iframe class="BLOG_video_class" allowfullscreen="" '
    'youtube-src-id="{ytid}" src="https://www.youtube.com/embed/{ytid}" '
    'style="border: none; width: 100%; aspect-ratio: 16/9;"></iframe>'
)


class Block:
    def __init__(self, kind, value, date=None):
        self.kind = kind  # "text" | "img" | "video" | "raw"
        self.value = value
        self.date = date       # attribut data-date conservé (p/img)
        self.caption = None   # légende Blogspot à restituer en <p>


class Transformer(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks = []
        self.raw_stack = []       # tags script/style : contenu brut
        self.raw_tag = None
        self.raw_buf = []
        self.text_buf = []
        self.p_date = None
        self.table_stack = []     # pile d'états : [{"imgs": [], "caption": None}]
        self.pending_caption = None
        self.iframe_attrs = None
        self.caption_tag = None    # balise tr-caption ouverte : légende en cours
        self.caption_buf = []

    # --- helpers -------------------------------------------------

    def flush_text(self):
        text = re.sub(r"\s+", " ", "".join(self.text_buf)).strip()
        text = text.replace("\xa0", " ")
        self.text_buf = []
        if text and text != "&nbsp;":
            self.blocks.append(Block("text", text, self.p_date))
            self.p_date = None

    def emit_img(self, attrs):
        self.flush_text()
        d = dict(attrs)
        src = d.get("src", "").strip()
        if not src:
            return None
        alt = (self.pending_caption or d.get("alt") or "Photo").strip()
        self.pending_caption = None
        date = d.get("data-date", "").strip()
        date_attr = f' data-date="{html.escape(date, quote=True)}" ' if date else " "
        return Block(
            "img",
            f'<img class="galerie-item"{date_attr}'
            f'src="{html.escape(src, quote=True)}" '
            f'alt="{html.escape(alt, quote=True)}"/>',
            date or None,
        )

    def emit_video(self, attrs):
        self.flush_text()
        d = dict(attrs)
        src = d.get("src", "")
        ytid = d.get("youtube-src-id", "")
        if not ytid and "youtube.com/embed/" in src:
            ytid = src.rstrip("/").split("/")[-1]
        self.blocks.append(Block("video", VIDEO_IFRAME.format(ytid=html.escape(ytid))))

    # --- parsing -------------------------------------------------

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.flush_text()
            self.raw_tag = tag
            self.raw_buf = [self.get_starttag_text()]
            return
        if self.raw_tag:
            return
        if self.caption_tag is not None:
            return
        if "tr-caption" in (dict(attrs).get("class") or "").split():
            self.flush_text()
            self.caption_tag = tag
            self.caption_buf = []
            return
        if tag == "img":
            d = dict(attrs)
            if "display:none" in (d.get("style") or "").replace(" ", ""):
                self.flush_text()
                self.blocks.append(Block("raw", self.get_starttag_text()))
                return
            blk = self.emit_img(attrs)
            if blk is None:
                return
            if self.table_stack:
                self.table_stack[-1]["imgs"].append(blk)
            else:
                self.blocks.append(blk)
            return
        if tag == "iframe":
            self.iframe_attrs = attrs
            return
        if tag == "table":
            self.table_stack.append({"imgs": [], "caption": None})
            return
        if tag == "br":
            return
        if tag == "p":
            d = dict(attrs)
            self.p_date = d.get("data-date", "").strip() or None
            self.flush_text()
            return
        if tag in ("div", "td", "tr", "tbody", "span"):
            self.flush_text()

    def handle_startendtag(self, tag, attrs):
        if tag == "img":
            self.handle_starttag("img", attrs)
        elif tag == "br":
            pass

    def handle_endtag(self, tag):
        if self.raw_tag:
            if tag == self.raw_tag:
                self.blocks.append(
                    Block("raw", "".join(self.raw_buf) + f"</{tag}>")
                )
                self.raw_tag = None
                self.raw_buf = []
            return
        if tag == "table" and self.table_stack:
            state = self.table_stack.pop()
            imgs = state["imgs"]
            caption = (state["caption"] or "").strip()
            if caption and imgs:
                imgs[-1].caption = caption
            elif caption and not imgs:
                self.text_buf.append(caption)
                self.flush_text()
            if self.table_stack:
                self.table_stack[-1]["imgs"].extend(imgs)
            else:
                self.blocks.extend(imgs)
            return
        if self.caption_tag is not None:
            if tag == self.caption_tag:
                text = re.sub(r"\s+", " ", "".join(self.caption_buf)).strip()
                if text:
                    if self.table_stack:
                        state = self.table_stack[-1]
                        state["caption"] = (state["caption"] or "") + text
                    else:
                        self.text_buf.append(text)
                self.caption_tag = None
                self.caption_buf = []
            return
        if tag == "iframe":
            if self.iframe_attrs is not None:
                self.emit_video(self.iframe_attrs)
                self.iframe_attrs = None
            return
        if tag in ("p", "div", "td", "tr", "tbody", "span"):
            self.flush_text()

    def handle_comment(self, data):
        if not self.raw_tag:
            self.flush_text()
            self.blocks.append(Block("raw", f"<!--{data}-->"))

    def handle_data(self, data):
        if self.raw_tag:
            self.raw_buf.append(data)
            return
        if self.iframe_attrs is not None:
            return
        if self.caption_tag is not None:
            self.caption_buf.append(data)
            return
        self.text_buf.append(data)

    def handle_entityref(self, name):
        if self.raw_tag:
            self.raw_buf.append(f"&{name};")
        elif self.caption_tag is not None:
            self.caption_buf.append(html.unescape(f"&{name};"))
        else:
            self.text_buf.append(html.unescape(f"&{name};"))

    def close(self):
        super().close()
        self.flush_text()


def render(blocks):
    chunks = []
    gallery = []

    def flush_gallery():
        if gallery:
            chunks.append(
                '<div class="galerie-grille">\n'
                + "\n".join("  " + g.value for g in gallery)
                + "\n</div>"
            )
            gallery.clear()

    for blk in blocks:
        if blk.kind == "img":
            gallery.append(blk)
            if blk.caption:
                flush_gallery()
                chunks.append(f"<p>{blk.caption}</p>")
            continue
        flush_gallery()
        if blk.kind == "video":
            chunks.append('<div class="video-container">\n' + blk.value + "\n</div>")
        elif blk.kind == "text":
            date = f' data-date="{blk.date}"' if blk.date else ""
            chunks.append(f"<p{date}>{blk.value}</p>")
        else:
            chunks.append(blk.value)
    flush_gallery()

    return "\n\n".join(chunks) + "\n"


def transform(content):
    parser = Transformer()
    parser.feed(content)
    parser.close()
    return render(parser.blocks)


def main():
    ap = argparse.ArgumentParser(
        description="Nettoie un article Blogspot vers le format galerie du blog."
    )
    ap.add_argument("fichier", help="fichier HTML de l'article Blogspot")
    ap.add_argument("-o", "--output", help="fichier de sortie (défaut : stdout)")
    args = ap.parse_args()

    with open(args.fichier, encoding="utf-8") as f:
        content = f.read()

    result = transform(content)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(result)
        print(f"Écrit : {args.output}", file=sys.stderr)
    else:
        sys.stdout.write(result)


if __name__ == "__main__":
    main()
