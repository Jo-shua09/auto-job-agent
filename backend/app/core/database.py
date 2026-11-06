import os
from threading import Lock
from typing import Any

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

mongo_uri = os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017")
database_name = os.getenv("MONGODB_DATABASE", "verdant")
mongo_client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
db = mongo_client[database_name]
_indexes_ready = False
_index_lock = Lock()


def ensure_indexes() -> None:
    global _indexes_ready
    if _indexes_ready:
        return
    with _index_lock:
        if _indexes_ready:
            return
        db.users.create_index("email", unique=True, name="unique_user_email")
        for collection_name in (
            "jobs",
            "vault",
            "tailored_packages",
            "execution_logs",
            "email_events",
            "activity_stream",
        ):
            db[collection_name].create_index(
                [("user_id", 1), ("_document_id", 1)],
                name=f"{collection_name}_user_document",
            )
        _indexes_ready = True


class DocumentSnapshot:
    def __init__(self, record: dict[str, Any] | None, document_id: str):
        self._record = record
        self.id = document_id
        self.exists = record is not None

    def to_dict(self) -> dict[str, Any] | None:
        if self._record is None:
            return None
        return {
            key: value
            for key, value in self._record.items()
            if key not in {"_id", "_document_id"}
        }


class CollectionReference:
    def __init__(
        self,
        collection_name: str,
        owner_id: str | None = None,
        filters: dict[str, Any] | None = None,
    ):
        self.collection_name = collection_name
        self.owner_id = owner_id
        self.filters = filters or {}

    def document(self, document_id: str) -> "DocumentReference":
        return DocumentReference(self.collection_name, document_id, self.owner_id)

    def where(self, field: str, operator: str, value: Any) -> "CollectionReference":
        if operator != "==":
            raise ValueError(f"Unsupported MongoDB query operator: {operator}")
        return CollectionReference(
            self.collection_name,
            self.owner_id,
            {**self.filters, field: value},
        )

    def stream(self) -> list[DocumentSnapshot]:
        query = self._query()
        return [
            DocumentSnapshot(record, record["_document_id"])
            for record in db[self.collection_name].find(query)
        ]

    def delete(self) -> int:
        return db[self.collection_name].delete_many(self._query()).deleted_count

    def _query(self) -> dict[str, Any]:
        query = dict(self.filters)
        if self.owner_id is not None:
            query["user_id"] = self.owner_id
        return query


class DocumentReference:
    def __init__(
        self,
        collection_name: str,
        document_id: str,
        owner_id: str | None = None,
    ):
        self.collection_name = collection_name
        self.id = str(document_id)
        self.owner_id = owner_id

    @property
    def _mongo_id(self) -> str:
        if self.owner_id is None:
            return self.id
        return f"{len(self.owner_id)}:{self.owner_id}:{self.id}"

    def get(self) -> DocumentSnapshot:
        record = db[self.collection_name].find_one(self._query())
        return DocumentSnapshot(record, self.id)

    def set(self, payload: dict[str, Any], merge: bool = False) -> None:
        record = dict(payload)
        record["_id"] = self._mongo_id
        record["_document_id"] = self.id
        if self.owner_id is not None:
            record["user_id"] = self.owner_id
        elif self.collection_name == "users":
            record["user_id"] = self.id

        query = self._query()
        if merge:
            updates = {key: value for key, value in record.items() if key != "_id"}
            db[self.collection_name].update_one(query, {"$set": updates}, upsert=True)
        else:
            db[self.collection_name].replace_one(query, record, upsert=True)

    def update(self, payload: dict[str, Any]) -> None:
        updates = dict(payload)
        updates.pop("_id", None)
        updates.pop("_document_id", None)
        if self.owner_id is not None:
            updates["user_id"] = self.owner_id
        result = db[self.collection_name].update_one(self._query(), {"$set": updates})
        if result.matched_count == 0:
            raise ValueError(f"Document {self.id} does not exist.")

    def collection(self, collection_name: str) -> CollectionReference:
        return CollectionReference(collection_name, owner_id=self.id)

    def _query(self) -> dict[str, Any]:
        query = {"_id": self._mongo_id}
        if self.owner_id is not None:
            query["user_id"] = self.owner_id
        return query


def get_user_ref(user_id: str) -> DocumentReference:
    if not user_id:
        raise RuntimeError("A signed-in Verdant user is required.")
    return DocumentReference("users", user_id)
