# check-soft.ts's other half: compiles GLSL ES 3.00 with Mesa's software renderer (llvmpipe) in this process, with no
# browser and no card, and draws the textures' jobs with it. Python's ctypes alone.
#
#   softgl.py <file.json>   as check-soft.ts writes it: { programs: [{name, vertex, fragment}], side, draws: [...] }
import base64, ctypes, json, os, sys

os.environ.setdefault("LIBGL_ALWAYS_SOFTWARE", "1")
os.environ.setdefault("__EGL_VENDOR_LIBRARY_FILENAMES", "/usr/share/glvnd/egl_vendor.d/50_mesa.json")
egl, gl = ctypes.CDLL("libEGL.so.1"), ctypes.CDLL("libGLESv2.so.2")
egl.eglGetPlatformDisplay.restype = egl.eglCreateContext.restype = ctypes.c_void_p
egl.eglGetPlatformDisplay.argtypes = [ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
egl.eglInitialize.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
egl.eglChooseConfig.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]
egl.eglCreateContext.argtypes = egl.eglMakeCurrent.argtypes = [ctypes.c_void_p] * 4
gl.glGetString.restype = ctypes.c_char_p
# EGL_PLATFORM_SURFACELESS_MESA; an ES 3 context with no surface.
display = egl.eglGetPlatformDisplay(0x31DD, None, None)
config, count = ctypes.c_void_p(), ctypes.c_int()
if not display or not egl.eglInitialize(display, None, None): sys.exit("softgl: no software display (Mesa's EGL)")
egl.eglBindAPI(0x30A0)
egl.eglChooseConfig(display, (ctypes.c_int * 5)(0x3040, 0x0040, 0x3033, 0x0001, 0x3038), ctypes.byref(config), 1, ctypes.byref(count))
context = egl.eglCreateContext(display, config, None, (ctypes.c_int * 3)(0x3098, 3, 0x3038))
if not context or not egl.eglMakeCurrent(display, None, None, context): sys.exit("softgl: no ES 3 context")

def shader(kind, text):
    s = gl.glCreateShader(kind)
    gl.glShaderSource(s, 1, ctypes.byref(ctypes.c_char_p(text.encode())), None)
    gl.glCompileShader(s)
    ok, log = ctypes.c_int(), ctypes.create_string_buffer(65536)
    gl.glGetShaderiv(s, 0x8B81, ctypes.byref(ok))
    gl.glGetShaderInfoLog(s, 65536, None, log)
    return s, ok.value, log.value.decode()

def program(vertex, fragment):
    v, okv, lv = shader(0x8B31, vertex)
    f, okf, lf = shader(0x8B30, fragment)
    if not (okv and okf): return 0, "vertex: " + lv + "\nfragment: " + lf
    p = gl.glCreateProgram()
    gl.glAttachShader(p, v); gl.glAttachShader(p, f); gl.glLinkProgram(p)
    ok, log = ctypes.c_int(), ctypes.create_string_buffer(65536)
    gl.glGetProgramiv(p, 0x8B82, ctypes.byref(ok))
    gl.glGetProgramInfoLog(p, 65536, None, log)
    return (p if ok.value else 0), log.value.decode()

d = json.load(open(sys.argv[1]))
made, failed = {}, []
for p in d["programs"]:
    made[p["name"]], log = program(p["vertex"], p["fragment"])
    if not made[p["name"]]: failed.append(p["name"] + "\n" + log[:2000])
side, texture, target, vao = d["side"], ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint()
gl.glGenTextures(1, ctypes.byref(texture)); gl.glBindTexture(0x0DE1, texture); gl.glTexStorage2D(0x0DE1, 1, 0x8058, side, side)
gl.glGenFramebuffers(1, ctypes.byref(target)); gl.glBindFramebuffer(0x8D40, target); gl.glFramebufferTexture2D(0x8D40, 0x8CE0, 0x0DE1, texture, 0)
gl.glGenVertexArrays(1, ctypes.byref(vao)); gl.glBindVertexArray(vao)
layers = []
for layer in d["layers"]:
    for band in layer["bands"]:
        p = made[layer["program"]]
        if not p: continue
        gl.glUseProgram(p); gl.glViewport(0, band["first"], side, band["rows"])
        gl.glUniform4fv(gl.glGetUniformLocation(p, b"uJob"), len(band["uniforms"]) // 4, (ctypes.c_float * len(band["uniforms"]))(*band["uniforms"]))
        gl.glDrawArrays(4, 0, 3)
    pixels = ctypes.create_string_buffer(side * side * 4)
    gl.glReadPixels(0, 0, side, side, 0x1908, 0x1401, pixels)
    layers.append(base64.b64encode(pixels.raw).decode())
print(json.dumps({"renderer": gl.glGetString(0x1F01).decode() + ", " + gl.glGetString(0x1F02).decode(), "failed": failed, "layers": layers}))
