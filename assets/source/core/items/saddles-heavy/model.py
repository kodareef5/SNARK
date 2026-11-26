"""Adapt the four fitted saddle trees to rest on their panels and loose tack."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from geometry import Saddle, materials, panel_height


def pair(points, sign):
    return [(sign * x, y, z) for x, y, z in points]


def strap(saddle, points, width, depth=.016):
    if saddle.level == 2 and len(points) > 4:
        points = [points[0], points[2], *points[-2:]]
    saddle.sweep(points, "leather", width, depth, axis=None, strap=True)


def bow(saddle, y, x, base, rise, surface, width):
    profile = [(-1, 0), (-.88, .60), (-.55, .89), (0, 1), (.55, .89), (.88, .60), (1, 0)]
    if saddle.level == 2:
        profile = [profile[i] for i in (0, 2, 3, 4, 6)]
    saddle.sweep([(x * u, y, base + rise * v) for u, v in profile], surface, width)


def stego(s):
    s.panel([(-.40, .21, .235), (-.32, .28, .222), (-.13, .315, .197),
             (.12, .265, .195), (.28, .225, .217), (.35, .17, .225)],
            "leather", .096, .040)
    for sign in (-1, 1):
        # These separate rolls extend behind the seat and leave the spine channel open.
        s.sweep(pair([(.235, -.62, .084), (.227, -.52, .083), (.211, -.31, .080),
                      (.176, -.05, .080), (.151, .22, .084), (.138, .35, .090)], sign),
                "leather", .124, .160, axis=(1, 0, 0))
        s.sweep(pair([(.25, -.36, .155), (.24, -.10, .157), (.20, .15, .165), (.16, .29, .179)], sign),
                "ash", .055)
        grip = pair([(.17, .264, .241), (.18, .295, .356), (.169, .273, .492), (.153, .230, .506)], sign)
        s.sweep(grip, "ash", .039)
        if s.level == 0:
            s.sweep(grip[1:3], "leather", .045, bend=False)

    bow(s, -.346, .265, .166, .178, "ash", .054)
    bow(s, .283, .199, .189, .151, "ash", .048)
    strap(s, [(.23, -.26, .122), (.363, -.20, .085), (.48, -.042, .028),
              (.60, .098, .012), (.544, .205, .018), (.419, .203, .021)], .090)
    strap(s, [(-.24, -.28, .127), (-.400, -.35, .066), (-.526, -.45, .021),
              (-.576, -.55, .013), (-.493, -.656, .021)], .104)
    s.buckle(-.528, -.563, .025, .115, .126, -1.40, s.level < 2)
    for sign, x, y, angle in ((-1, -.43, .28, 2.66), (1, .426, .385, 0.53)):
        strap(s, [(sign * .204, .239, .150), (sign * .315, .29, .063), (x, y, .040)], .046)
        s.stirrup(x + .056 * sign, y + .025, .037, .172, .190, angle)


def rex(s):
    pad = [(-.78, .42, .145), (-.69, .63, .157), (-.43, .81, .194), (-.16, .84, .185),
           (.12, .81, .178), (.40, .73, .179), (.63, .58, .178), (.72, .37, .162)]
    s.panel(pad if s.level < 2 else pad[::2] + pad[-1:], "leather", .125, .067, floor=0,
            quilt=.012 if s.level == 0 else 0)
    seat = [(-.55, .335, .405), (-.437, .410, .441), (-.28, .425, .321), (-.105, .401, .266),
            (.10, .351, .264), (.28, .286, .282), (.416, .230, .324), (.491, .154, .309)]
    s.panel(seat if s.level < 2 else seat[::2] + seat[-1:], "leather", .112, .059)
    bow(s, -.47, .405, .272, .187, "ash", .073)
    for sign in (-1, 1):
        welt = pair([(w * .978, y, z - .093) for y, w, z in pad], sign)
        if s.level < 2:
            s.sweep(welt, "leather", .027, bend=False)
        rail = pair([(.357, -.491, .225), (.427, -.308, .217), (.403, -.080, .198),
                     (.352, .216, .196), (.253, .484, .242)], sign)
        s.sweep(rail, "ash", .088, .067)
        grip = pair([(.205, .224, .241), (.239, .28, .376), (.241, .391, .461),
                     (.220, .485, .407), (.172, .511, .283)], sign)
        s.sweep(grip, "ash", .059)
        if s.level == 0:
            s.sweep(grip[1:4], "leather", .068)
            for lane in (.50, .75):
                seam = pair([(w * .95 * lane, y, panel_height(y, lane, z, .067, .012))
                             for y, w, z in pad[1:-1]], sign)
                s.sweep(seam, "leather", .009, bend=False)

    strap(s, [(-.57, -.396, .109), (-.816, -.490, .080), (-.973, -.578, .039),
              (-1.02, -.45, .013), (-.952, -.306, .015)], .112, .020)
    strap(s, [(.586, -.415, .108), (.813, -.511, .063), (.959, -.578, .023),
              (1.142, -.545, .014), (1.19, -.388, .017)], .112, .024)
    s.buckle(1.164, -.453, .035, .128, .153, 1.10, s.level < 2)
    strap(s, [(.57, .326, .120), (.76, .469, .055), (.89, .658, .014), (.789, .770, .016)], .102, .020)
    strap(s, [(-.549, .31, .107), (-.733, .477, .043), (-.881, .544, .014),
              (-1.031, .515, .017)], .102, .020)
    s.buckle(-.908, .540, .032, .123, .145, -.20, s.level < 2)
    for sign, x, y, angle in ((-1, -.901, .064, 2.93), (1, .907, .05, .29)):
        strap(s, [(sign * .367, .028, .187), (sign * .603, .018, .139),
                  (sign * .793, y, .066), (x, y, .044)], .065)
        s.stirrup(x + .117 * sign, y - .034, .034, .234, .242, angle)


def spino(s):
    # The aft notch clears the leading edge of the sail behind the shoulder.
    blanket = [(-.56, .080, .105), (-.47, .226, .094), (-.32, .288, .102), (-.14, .382, .114),
               (.105, .485, .136), (.30, .500, .126), (.49, .437, .106), (.61, .275, .091)]
    s.panel(blanket, "canvas", .088, .038, floor=0)
    s.panel([(-.351, .158, .207), (-.272, .213, .211), (-.10, .233, .196), (.125, .281, .208),
             (.25, .243, .259), (.32, .171, .251)], "leather", .095, .039)
    bow(s, -.29, .219, .147, .086, "leather", .054)
    bow(s, .249, .245, .169, .176, "leather", .052)
    for sign in (-1, 1):
        s.sweep(pair([(.194, -.294, .141), (.218, -.127, .145), (.247, .14, .149),
                      (.218, .284, .181)], sign), "leather", .073)
        grip = pair([(.16, .24, .236), (.17, .291, .375), (.176, .249, .445), (.178, .239, .453)], sign)
        s.sweep(grip, "leather", .046)
        if s.level == 0:
            s.sweep(grip[1:3], "metal", .050, bend=False)
        if s.level < 2:
            welt = pair([(w * .976, y, z - .047) for y, w, z in blanket], sign)
            s.sweep(welt, "canvas", .023, bend=False)

    strap(s, [(-.25, -.172, .140), (-.385, -.253, .100), (-.476, -.349, .039),
              (-.532, -.517, .015), (-.669, -.564, .017), (-.770, -.443, .022)], .100, .018)
    strap(s, [(.25, -.176, .140), (.412, -.244, .081), (.531, -.361, .020),
              (.59, -.443, .015), (.746, -.394, .017)], .097, .018)
    s.buckle(.61, -.419, .032, .122, .133, .16, s.level < 2)
    for sign, x, y, angle in ((-1, -.562, .214, 2.28), (1, .56, .327, 0.40)):
        strap(s, [(sign * .224, .144, .153), (sign * .431, .211, .078), (x, y, .044)], .071)
        s.stirrup(x + .096 * sign, y + .056, .032, .168, .221, angle)


def brachio(s):
    pad = [(-.74, .55, .122), (-.65, .81, .145), (-.42, .933, .172), (-.12, .953, .192),
           (.22, .913, .190), (.48, .823, .159), (.63, .681, .151), (.70, .51, .139)]
    s.panel(pad if s.level < 2 else pad[::2] + pad[-1:], "canvas", .134, .050, floor=0)
    for sign in (-1, 1):
        s.sweep(pair([(.322, -.386, .225), (.321, -.29, .305), (.322, .233, .304),
                      (.303, .343, .223)], sign), "metal", .059)
        if s.level < 2:
            s.sweep(pair([(.319, -.465, .177), (.322, -.306, .202), (.323, -.115, .207),
                          (.316, .178, .199), (.297, .404, .181)], sign), "leather", .121, .122)
            skirt = pair([(.362, -.394, .239), (.369, -.22, .244), (.365, .11, .242),
                          (.343, .326, .236)], sign)
            s.sweep(skirt, "leather", .137, .083, axis=(0, 0, 1), strap=True)
            s.sweep(pair([(.170, .222, .383), (.175, .292, .481), (.172, .271, .546)], sign),
                    "leather", .049)

    seat = [(-.46, .285, .375), (-.35, .342, .402), (-.17, .391, .367), (.11, .38, .362),
            (.27, .341, .386), (.39, .282, .394)]
    s.panel(seat if s.level < 2 else seat[::2] + seat[-1:], "leather", .110, .047)
    crown = [(-.51, .490, 1.021), (-.391, .522, 1.001), (-.232, .555, .975),
             (-.05, .560, .965), (.16, .551, .975), (.32, .538, 1.002), (.489, .495, 1.028)]
    s.panel(crown if s.level < 2 else crown[::2], "canvas", .021, .113)
    for sign in (-1, 1):
        for y in (-.376, .31):
            s.sweep(pair([(.375, y * .90, .296), (.429, y, .569),
                          (.492, y * 1.21, .891)], sign), "metal", .043)
        if s.level < 2:
            hem = pair([(width, y, z - .121) for y, width, z in crown], sign)
            s.sweep(hem, "canvas", .028, bend=False)
            if s.level == 0:
                frame = [(x * .971, y, z - .016) for x, y, z in hem[1:-1]]
                s.sweep(frame, "metal", .025, bend=False)
    if s.level < 2:
        for y, width, base in ((-.455, .492, .878), (.420, .498, .886)):
            bow(s, y, width, base, .116, "metal", .030)
    strap(s, [(-.379, .081, .202), (-.688, .02, .167), (-.918, -.058, .097),
              (-1.07, -.145, .022), (-1.18, -.222, .015), (-1.195, -.386, .017)], .142, .022)
    s.buckle(-1.179, -.283, .034, .155, .157, 1.52, s.level < 2)
    strap(s, [(.348, .111, .254), (.693, .240, .151), (.932, .324, .079),
              (1.089, .414, .029), (1.17, .588, .017), (1.091, .683, .017)], .132, .021)
    if s.level < 2:
        s.buckle(1.151, .543, .034, .142, .159, 1.56, s.level == 0)
    ladder = [(.591, -.402, .188), (.794, -.410, .159), (.953, -.471, .073),
              (1.096, -.513, .041), (1.281, -.605, .024), (1.455, -.643, .021)]
    for shift in (0, .269):
        strap(s, [(x, y + shift, z) for x, y, z in ladder], .057, .025)
    for i in ((1, 2, 3, 4, 5) if s.level < 2 else (1, 3, 5)):
        x, y, z = ladder[i]
        s.sweep([(x, y - .010, z), (x, y + .279, z)], "metal", .035, .031, axis=(1, 0, 0), strap=True)
    strap(s, [(-.310, .235, .274), (-.539, .381, .179), (-.722, .470, .09), (-.908, .512, .046)], .069)
    s.stirrup(-1.024, .566, .035, .205, .229, 2.65)


def build():
    finishes = materials()
    for species, shape in (("stego", stego), ("rex", rex), ("spino", spino), ("brachio", brachio)):
        center = None
        for level in range(3):
            saddle = Saddle(level)
            shape(saddle)
            if center is None:
                center = saddle.center()
            base = f"saddle_{species}"
            saddle.object(f"{base}_LOD{level}" if level else base, center, finishes)


if __name__ == "__main__":
    build()
