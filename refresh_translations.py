"""Save Russian catalog names with local Argos models; no translation at page load."""

from pathlib import Path, PurePosixPath
from concurrent.futures import ThreadPoolExecutor
import argparse
import json
import os
import re
import shutil
import sys
import zipfile

import requests


ROOT = Path(__file__).resolve().parent
FILES = ("products.json", "lidl-products.json", "eurospin-products.json")
MODELS = {
    "it_en": "https://argos-net.com/v1/translate-it_en-1_0.argosmodel",
    "en_ru": "https://argos-net.com/v1/translate-en_ru-1_9.argosmodel",
}
FRESH_CODES = re.compile(r"\b(?:es|it)\s+\d+(?:[-/]\d+|\+)?(?=\s|$|i{1,2}\^)|\bi{1,2}\^|\bsf\b", re.I)
PACKAGE_CODES = re.compile(r"\b(?:bs|btg|vtbg|vs|vh|ct|rt|mz|jsk)\b", re.I)
SOURCE_NAME_FIXES = {
    "lidl-everli-536721": ("1,75 l", "Pepsi 1,75 l", "Газированный напиток Pepsi, 1,75 л"),
    "lidl-everli-5199755": ("0.0", "Birra analcolica Heineken 0.0 33 cl", "Безалкогольное пиво Heineken 0.0, 0,33 л"),
    "lidl-everli-536755": ("Pet", "Coca-Cola Original Taste 1 l", "Газированный напиток Coca-Cola Original Taste, 1 л"),
    "lidl-everli-514549": ("Xylit Mti Sp.4x32pz.", "Vivident Xylit senza zucchero, 4 confezioni", "Жевательная резинка Vivident Xylit без сахара, 4 упаковки"),
}


def clean_name(product):
    """Normalize broken source names and service codes without hiding Russian text."""
    fix = SOURCE_NAME_FIXES.get(product["key"])
    if fix and product["name_it"] == fix[0]:
        product.update(name_it=fix[1], name_ru=fix[2])
        return False
    if product["store"] != "Coop":
        return False
    original = product["name_it"]
    fresh = product["category"] not in {"care", "cleaning", "home", "clothes", "garden", "pets"} and bool(FRESH_CODES.search(original))
    if not fresh and not PACKAGE_CODES.search(original) and not re.search(r"f\.lli\s+orsero", original, re.I):
        return False

    def clean(text):
        text = re.sub(r"\bf\.lli\s+orsero\b", "Orsero", text, flags=re.I)
        if fresh:
            text = re.sub(r"\b(?:es|it)\s+\d+(?:[-/]\d+|\+)?(?=\s|$|i{1,2}\^)", "", text, flags=re.I)
            text = re.sub(r"\b(?:es|it)\s+(?=i{1,2}\^)|\bi{1,2}\^", "", text, flags=re.I)
            text = re.sub(r"\b(?:es|it)(?=\s+(?:bs|btg|vtbg|vs|vh|ct|rt|mz|jsk)\b)", "", text, flags=re.I)
        text = re.sub(r"\b(?:sf|bs|btg|vtbg|vs|vh|ct|rt|mz|jsk)\b\.?", "", text, flags=re.I)
        return " ".join(text.split())

    product["name_it"] = clean(original)
    product["name_ru"] = re.sub(r"\b(?:бсг?|бтг|втбг|вх|кт|рт|мз)\b\.?", "", clean(product.get("name_ru", "")), flags=re.I).strip()
    if product["key"] == "coop-1258361":
        product["name_ru"] = "Ананас Gold Orsero"
        return False
    return fresh


def write_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temporary.replace(path)


def model_package(code):
    destination = ROOT / ".translation-models" / code
    if (destination / "model" / "model.bin").exists() and (destination / "sentencepiece.model").exists():
        return destination
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination / "package.download"
    print("Downloading translation model:", code, flush=True)
    with requests.get(MODELS[code], stream=True, timeout=(20, 120)) as response:
        response.raise_for_status()
        with archive.open("wb") as output:
            for chunk in response.iter_content(1024 * 1024):
                output.write(chunk)
    with zipfile.ZipFile(archive) as package:
        for member in package.infolist():
            parts = PurePosixPath(member.filename).parts
            if not parts or ".." in parts or member.is_dir():
                continue
            relative = Path(*parts[1:])
            if not relative.parts or relative.parts[0] != "model" and relative.name not in {"sentencepiece.model", "metadata.json", "LICENSE"}:
                continue
            target = (destination / relative).resolve()
            if not target.is_relative_to(destination.resolve()):
                raise ValueError("Invalid translation package path")
            target.parent.mkdir(parents=True, exist_ok=True)
            with package.open(member) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)
    archive.unlink()
    print("Translation model ready:", code, flush=True)
    return destination


def local_translator():
    # Optional local install; CI installs the same dependencies from requirements-translation.txt.
    runtime = ROOT / ".translation-runtime"
    if runtime.exists():
        sys.path.insert(0, str(runtime))
    import ctranslate2
    import sentencepiece

    with ThreadPoolExecutor(max_workers=2) as pool:
        folders = list(pool.map(model_package, MODELS))
    stages = [(ctranslate2.Translator(str(folder / "model"), device="cpu", compute_type="int8",
                                     intra_threads=min(4, os.cpu_count() or 1)),
               sentencepiece.SentencePieceProcessor(model_file=str(folder / "sentencepiece.model")))
              for folder in folders]

    def translate(names):
        values = [re.sub(r"\bfettine\b", "fette", re.sub(r"\bpan speziato\b", "pan di zenzero", name.lower())) for name in names]
        for index, (engine, tokenizer) in enumerate(stages):
            tokens = [tokenizer.encode(name, out_type=str) for name in values]
            results = engine.translate_batch(tokens, beam_size=4, max_decoding_length=128, replace_unknowns=True)
            values = [tokenizer.decode(result.hypotheses[0]).replace("▁", " ").strip() for result in results]
            if index == 0:
                values = [re.sub(r"\b(?:chocolate fondente|fondente chocolate)\b", "dark chocolate", value, flags=re.I) for value in values]
                values = [re.sub(r"\bcookies\b", "biscuits", re.sub(r"\bspicy (?=(?:cookies|biscuits|bread|cakes|sweets)\b)", "spiced ", value, flags=re.I), flags=re.I) for value in values]
        for index, source in enumerate(names):
            if not re.search(r"\w", values[index]):
                values[index] = source
            if re.search(r"\bfettine\b", source, re.I):
                values[index] = re.sub(r"\bсрезы\b", "ломтики", values[index], flags=re.I)
            if "pasta frolla" in source.lower():
                values[index] = re.sub(r"\bкондитерские печенья\b", "песочное печенье", values[index], flags=re.I)
        return [value[:1].upper() + value[1:] for value in values]
    return translate


def refresh_names():
    catalogs = {filename: json.loads((ROOT / filename).read_text(encoding="utf-8")) for filename in FILES}
    cache_path = ROOT / "translations-ru.json"
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    pending = set()
    for products in catalogs.values():
        for product in products:
            regenerate = clean_name(product)
            source = product["name_it"].strip()
            existing = product.get("name_ru", "").strip()
            if existing and not regenerate:
                cache.setdefault(source, existing)
            elif source not in cache:
                pending.add(source)
    print("Russian names to translate:", len(pending), flush=True)
    if pending:
        translate = local_translator()
        names = sorted(pending)
        for start in range(0, len(names), 64):
            batch = names[start:start + 64]
            translated = translate(batch)
            if len(translated) != len(batch) or not all(translated):
                raise ValueError("Incomplete translation batch")
            cache.update(zip(batch, translated))
            write_json(cache_path, dict(sorted(cache.items())))
            print("Russian names saved:", min(start + 64, len(names)), "/", len(names), flush=True)
    write_json(cache_path, dict(sorted(cache.items())))
    for filename, products in catalogs.items():
        for product in products:
            product["name_ru"] = cache[product["name_it"].strip()]
        write_json(ROOT / filename, products)
    print("Russian names available:", sum(len(products) for products in catalogs.values()), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", action="store_true")
    options = parser.parse_args()
    if options.sample:
        print(local_translator()(["Ananas", "Yogurt bianco senza lattosio", "Dolcetti con Doppio Ripieno e Copertura di Cioccolato Fondente"]), flush=True)
    else:
        refresh_names()
