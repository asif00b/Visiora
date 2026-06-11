import json

from sqlalchemy.types import Text, TypeDecorator, UserDefinedType


class _PgVector(UserDefinedType):
    cache_ok = True

    def __init__(self, dimensions: int):
        self.dimensions = dimensions

    def get_col_spec(self, **kw):
        return f"vector({self.dimensions})"


class VectorEmbedding(TypeDecorator):
    """
    Store a fixed-size pgvector column on PostgreSQL and JSON text elsewhere.

    The app never performs live recognition through PostgreSQL, but this keeps
    embeddings queryable for admin tools and future offline analysis.
    """

    impl = Text
    cache_ok = True

    def __init__(self, dimensions: int = 512, *args, **kwargs):
        self.dimensions = dimensions
        super().__init__(*args, **kwargs)

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(_PgVector(self.dimensions))
        return dialect.type_descriptor(Text())

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        arr = list(value)
        if len(arr) != self.dimensions:
            return None
        arr = [float(v) for v in arr]
        if dialect.name == "postgresql":
            return "[" + ",".join(str(v) for v in arr) + "]"
        return json.dumps(arr)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, list):
            return value
        text = str(value).strip()
        try:
            if text.startswith("[") and text.endswith("]"):
                return [float(v) for v in text[1:-1].split(",") if v.strip()]
            return json.loads(text)
        except Exception:
            return None
