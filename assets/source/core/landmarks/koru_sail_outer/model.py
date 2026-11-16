from pathlib import Path
sail_source=Path(__file__).resolve().parent.parent/"koru-sails/model.py"
sail_scope={"__file__":str(sail_source),"__name__":"koru_sails"}
exec(compile(sail_source.read_text(),str(sail_source),"exec"),sail_scope)
sail_scope["build"]("outer")
