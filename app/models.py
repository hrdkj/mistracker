import json
import os
import uuid
from datetime import datetime
from typing import Optional

DATA_FILE = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "data", "mistakes.json"
)

MISTAKE_TYPES = [
    "Conceptual",
    "Silly/Careless",
    "Calculation",
    "Time Pressure",
    "Misread Question",
    "Memory/Formula",
]


def _load_data() -> list[dict]:
    """Load mistakes from JSON file."""
    if not os.path.exists(DATA_FILE):
        return []
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return []


def _save_data(data: list[dict]) -> None:
    """Save mistakes to JSON file atomically."""
    temp_file = DATA_FILE + ".tmp"
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(temp_file, DATA_FILE)


def _normalized_text(value: Optional[str]) -> str:
    """Normalize optional text values."""
    if not value:
        return ""
    return str(value).strip()


def _parse_subtopics(value) -> list[str]:
    """Normalize subtopics from list/CSV string into a deduplicated list."""
    raw_items = []

    if isinstance(value, list):
        raw_items = [str(v) for v in value if v is not None]
    elif isinstance(value, str):
        raw_items = value.split(",")
    elif value is not None:
        raw_items = [str(value)]

    result = []
    seen = set()
    for item in raw_items:
        normalized = item.strip()
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(normalized)

    return result


def _normalize_mistake(mistake: dict) -> dict:
    """Return a mistake with category/subtopic fields guaranteed."""
    category = _normalized_text(mistake.get("category"))
    if not category:
        category = _normalized_text(mistake.get("topic"))

    subtopics = _parse_subtopics(mistake.get("subtopics"))
    if not subtopics:
        subtopics = _parse_subtopics(mistake.get("subtopic"))
    subtopic = ", ".join(subtopics)
    concept = _normalized_text(mistake.get("concept"))

    normalized = dict(mistake)
    normalized["category"] = category
    normalized["subtopics"] = subtopics
    normalized["subtopic"] = subtopic
    normalized["concept"] = concept

    # Keep topic for backward compatibility in old views/clients.
    normalized["topic"] = category
    return normalized


def get_all_mistakes(
    category: Optional[str] = None,
    subtopic: Optional[str] = None,
    mistake_type: Optional[str] = None,
) -> list[dict]:
    """Get all mistakes, optionally filtered by category/subtopic/type."""
    mistakes = _load_data()
    mistakes = [_normalize_mistake(m) for m in mistakes]

    if category:
        category_filter = category.lower()
        mistakes = [
            m for m in mistakes if m.get("category", "").lower() == category_filter
        ]

    if subtopic:
        subtopic_filter = subtopic.lower()
        mistakes = [
            m
            for m in mistakes
            if subtopic_filter in [s.lower() for s in m.get("subtopics", [])]
        ]

    if mistake_type:
        mistakes = [
            m
            for m in mistakes
            if m.get("mistake_type", "").lower() == mistake_type.lower()
        ]

    # Sort by date, newest first
    mistakes.sort(key=lambda x: x.get("date_added", ""), reverse=True)
    return mistakes


def get_mistake_by_id(mistake_id: str) -> Optional[dict]:
    """Get a single mistake by ID."""
    mistakes = _load_data()
    for m in mistakes:
        if m.get("id") == mistake_id:
            return _normalize_mistake(m)
    return None


def add_mistake(data: dict) -> dict:
    """Add a new mistake entry."""
    mistakes = _load_data()

    category = _normalized_text(data.get("category"))
    if not category:
        category = _normalized_text(data.get("topic"))

    now = datetime.now().isoformat()
    subtopics = _parse_subtopics(data.get("subtopics"))
    if not subtopics:
        subtopics = _parse_subtopics(data.get("subtopic"))

    new_mistake = {
        "id": str(uuid.uuid4()),
        "category": category,
        "subtopics": subtopics,
        "subtopic": ", ".join(subtopics),
        "concept": _normalized_text(data.get("concept")),
        "topic": category,
        "question_image": data.get("question_image", ""),
        "solution_image": data.get("solution_image", ""),
        "mistake_type": data.get("mistake_type", "Conceptual"),
        "why_happened": data.get("why_happened", "").strip(),
        "how_to_avoid": data.get("how_to_avoid", "").strip(),
        "date_added": now,
        "date_modified": now,
    }

    mistakes.append(new_mistake)
    _save_data(mistakes)
    return new_mistake


def update_mistake(mistake_id: str, data: dict) -> Optional[dict]:
    """Update an existing mistake entry."""
    mistakes = _load_data()

    for i, m in enumerate(mistakes):
        if m.get("id") == mistake_id:
            # Update fields
            if "category" in data:
                category = _normalized_text(data["category"])
                mistakes[i]["category"] = category
                mistakes[i]["topic"] = category
            elif "topic" in data:
                category = _normalized_text(data["topic"])
                mistakes[i]["category"] = category
                mistakes[i]["topic"] = category
            if "subtopic" in data:
                subtopics = _parse_subtopics(data["subtopic"])
                mistakes[i]["subtopics"] = subtopics
                mistakes[i]["subtopic"] = ", ".join(subtopics)
            if "subtopics" in data:
                subtopics = _parse_subtopics(data["subtopics"])
                mistakes[i]["subtopics"] = subtopics
                mistakes[i]["subtopic"] = ", ".join(subtopics)
            if "concept" in data:
                mistakes[i]["concept"] = _normalized_text(data["concept"])
            if "question_image" in data:
                mistakes[i]["question_image"] = data["question_image"]
            if "solution_image" in data:
                mistakes[i]["solution_image"] = data["solution_image"]
            if "mistake_type" in data:
                mistakes[i]["mistake_type"] = data["mistake_type"]
            if "why_happened" in data:
                mistakes[i]["why_happened"] = data["why_happened"].strip()
            if "how_to_avoid" in data:
                mistakes[i]["how_to_avoid"] = data["how_to_avoid"].strip()

            mistakes[i]["date_modified"] = datetime.now().isoformat()
            _save_data(mistakes)
            return _normalize_mistake(mistakes[i])

    return None


def delete_mistake(mistake_id: str) -> bool:
    """Delete a mistake entry."""
    mistakes = _load_data()
    original_len = len(mistakes)
    mistakes = [m for m in mistakes if m.get("id") != mistake_id]

    if len(mistakes) < original_len:
        _save_data(mistakes)
        return True
    return False


def get_all_categories() -> list[str]:
    """Get all unique categories."""
    mistakes = _load_data()
    categories = set()
    for m in mistakes:
        normalized = _normalize_mistake(m)
        category = normalized.get("category", "")
        if category:
            categories.add(category)
    return sorted(list(categories))


def get_all_subtopics(category: Optional[str] = None) -> list[str]:
    """Get all unique subtopics, optionally by category."""
    mistakes = _load_data()
    subtopics = set()
    category_filter = category.lower() if category else None

    for m in mistakes:
        normalized = _normalize_mistake(m)
        if (
            category_filter
            and normalized.get("category", "").lower() != category_filter
        ):
            continue

        for subtopic in normalized.get("subtopics", []):
            if subtopic:
                subtopics.add(subtopic)

    return sorted(list(subtopics))


def get_analytics() -> dict:
    """Get analytics data for the dashboard."""
    mistakes = _load_data()

    # Count by mistake type
    type_counts = {}
    for mt in MISTAKE_TYPES:
        type_counts[mt] = 0

    for m in mistakes:
        mt = m.get("mistake_type", "Conceptual")
        if mt in type_counts:
            type_counts[mt] += 1
        else:
            type_counts[mt] = 1

    # Count by category
    category_counts = {}

    # Count by subtopic (nested under category when possible)
    subtopic_counts = {}

    for m in mistakes:
        normalized = _normalize_mistake(m)

        category = normalized.get("category", "").strip() or "Uncategorized"
        category_counts[category] = category_counts.get(category, 0) + 1

        normalized_subtopics = normalized.get("subtopics", [])
        if normalized_subtopics:
            for subtopic in normalized_subtopics:
                subtopic_key = f"{category} - {subtopic}"
                subtopic_counts[subtopic_key] = subtopic_counts.get(subtopic_key, 0) + 1
        else:
            subtopic_key = f"{category} - Unspecified"
            subtopic_counts[subtopic_key] = subtopic_counts.get(subtopic_key, 0) + 1

    sorted_categories = sorted(
        category_counts.items(), key=lambda x: x[1], reverse=True
    )
    sorted_subtopics = sorted(subtopic_counts.items(), key=lambda x: x[1], reverse=True)

    return {
        "total_mistakes": len(mistakes),
        "type_distribution": type_counts,
        "category_distribution": dict(sorted_categories[:10]),
        "subtopic_distribution": dict(sorted_subtopics[:10]),
        "most_common_type": max(type_counts.items(), key=lambda x: x[1])[0]
        if type_counts
        else None,
    }
