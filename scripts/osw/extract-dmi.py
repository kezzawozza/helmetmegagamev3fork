import os, re, sys, struct, zlib, shutil
from PIL import Image

SRC = "/home/user/ss13-special-codebases-archive/opensourceweb"
OUT = sys.argv[1]

DIRNAMES = {1:["S"],4:["S","N","E","W"],8:["S","N","E","W","SE","SW","NE","NW"]}

def dmi_desc(path):
    with open(path,"rb") as f:
        data = f.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n": return None
    i = 8
    while i < len(data):
        ln = struct.unpack(">I", data[i:i+4])[0]
        typ = data[i+4:i+8]
        body = data[i+8:i+8+ln]
        if typ in (b"zTXt", b"tEXt"):
            kw, rest = body.split(b"\x00", 1)
            if kw == b"Description":
                if typ == b"zTXt":
                    return zlib.decompress(rest[1:]).decode("utf-8","replace")
                return rest.decode("utf-8","replace")
        if typ == b"IEND": break
        i += 12 + ln
    return None

def parse(desc):
    w = h = 32
    states = []
    cur = None
    for line in desc.splitlines():
        s = line.strip()
        if s.startswith("width"): w = int(s.split("=")[1])
        elif s.startswith("height"): h = int(s.split("=")[1])
        elif s.startswith("state ="):
            cur = {"name": s.split("=",1)[1].strip().strip('"'), "dirs":1, "frames":1}
            states.append(cur)
        elif cur and s.startswith("dirs"): cur["dirs"] = int(s.split("=")[1])
        elif cur and s.startswith("frames"): cur["frames"] = int(s.split("=")[1])
    return w, h, states

def safe(s):
    s = re.sub(r'[^A-Za-z0-9_-]+', '_', s).strip('_.')
    return s or "unnamed"

def split(path, outdir):
    desc = dmi_desc(path)
    if not desc: return 0
    w, h, states = parse(desc)
    im = Image.open(path).convert("RGBA")
    cols = max(1, im.width // w)
    os.makedirs(outdir, exist_ok=True)
    idx = 0; n = 0; seen = {}
    for st in states:
        dn = DIRNAMES.get(st["dirs"], [str(i) for i in range(st["dirs"])])
        for fr in range(st["frames"]):
            for d in range(st["dirs"]):
                x = (idx % cols) * w; y = (idx // cols) * h
                idx += 1
                if y + h > im.height: continue
                name = safe(st["name"])
                if st["dirs"] > 1: name += "_" + dn[d]
                if st["frames"] > 1: name += "_f%d" % (fr+1)
                seen[name] = seen.get(name, 0) + 1
                if seen[name] > 1: name += "_%d" % seen[name]
                tile = im.crop((x, y, x+w, y+h))
                if not tile.getbbox(): continue   # skip fully blank cells
                tile.save(os.path.join(outdir, name + ".png"))
                n += 1
    return n

FOOD = {"food.dmi","food_ingredients.dmi","foodbs12.dmi","drinks.dmi","kitchen.dmi",
        "cooking.dmi","harvest.dmi","seeds.dmi","hydroponics.dmi","plants.dmi",
        "stewpan.dmi","cup.dmi","cigarettes.dmi","reagentfillings.dmi","chemical.dmi"}

roots = [os.path.join(SRC,"icons","obj"), os.path.join(SRC,"honk","icons","obj")]
sheets = splits = files = 0
for root in roots:
    for dirpath, _, names in os.walk(root):
        for nm in sorted(names):
            if not nm.lower().endswith(".dmi"): continue
            p = os.path.join(dirpath, nm)
            rel = os.path.relpath(p, SRC)
            base = nm[:-4]
            isfood = nm in FOOD
            group = "food" if isfood else "other"
            # sheet
            sd = os.path.join(OUT, group, "_sheets", os.path.dirname(os.path.relpath(p, root)))
            os.makedirs(sd, exist_ok=True)
            shutil.copyfile(p, os.path.join(sd, base + ".png"))
            sheets += 1
            # split
            relsub = os.path.relpath(p, root)[:-4]
            od = os.path.join(OUT, group, *[safe(x) for x in relsub.split(os.sep)])
            try:
                c = split(p, od)
            except Exception as e:
                print("skip", rel, e); c = 0
            splits += c; files += 1
print("dmi files:", files, "sheets:", sheets, "individual sprites:", splits)
