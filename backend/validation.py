"""Validation at the HTTP boundary and invariants for demo accounting."""
from __future__ import annotations

from copy import deepcopy
from typing import Any
import math
from datetime import datetime
from urllib.parse import urlparse


def identifier(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > 100 or not value.isascii() or any(not (c.isalnum() or c in "-_") for c in value):
        raise ValueError("Некорректный идентификатор")
    return value


def integer(value: Any, minimum: int, maximum: int) -> bool:
    return type(value) is int and minimum <= value <= maximum


def entities(items: Any) -> list[dict]:
    if not isinstance(items, list) or len(items) > 10000:
        raise ValueError("Некорректный список данных")
    ids = set()
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("Некорректная запись")
        key = identifier(item.get("id"))
        if key in ids:
            raise ValueError("Идентификаторы не должны повторяться")
        ids.add(key)
    return items


def timestamp(value: Any) -> bool:
    if not isinstance(value, str) or len(value) > 40:
        return False
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).tzinfo is not None
    except ValueError:
        return False


def validate_store(value: Any) -> dict:
    if not isinstance(value, dict) or type(value.get("version")) is not int or value["version"] != 1:
        raise ValueError("Некорректное состояние приложения")
    for name in ("venue", "settings", "profile", "oranges"):
        if not isinstance(value.get(name), dict):
            raise ValueError("Некорректное состояние приложения")
    venue = value["venue"]
    for field, limit in (("name", 50), ("address", 120)):
        if not isinstance(venue.get(field), str) or not venue[field].strip() or len(venue[field]) > limit:
            raise ValueError("Проверьте название и адрес заведения")
    if not integer(venue.get("bill"), 1, 10000000):
        raise ValueError("Некорректная сумма счёта")
    if "mapUrl" in venue and (not isinstance(venue["mapUrl"], str) or len(venue["mapUrl"]) > 2000 or urlparse(venue["mapUrl"]).scheme not in ("http", "https")):
        raise ValueError("Некорректная ссылка на карту")
    settings = value["settings"]
    shares = settings.get("shares", [])
    if not isinstance(shares, list) or len(shares) > 1000 or any(type(share) not in (int, float) or not math.isfinite(share) or not 0 <= share <= 100 for share in shares):
        raise ValueError("Некорректные доли")
    if shares and abs(sum(shares) - 100) > .001:
        raise ValueError("Доли должны составлять 100%")
    recipients = settings.get("recipientIds")
    if recipients is not None:
        if not isinstance(recipients, list) or len(recipients) != len(shares):
            raise ValueError("Проверьте получателей распределения")
        for person in recipients:
            identifier(person)
        if len(set(recipients)) != len(recipients):
            raise ValueError("Получатели не должны повторяться")
    profile = value["profile"]
    if "goal" in profile and (not isinstance(profile["goal"], str) or len(profile["goal"]) > 60):
        raise ValueError("Некорректная цель")
    if "target" in profile and not integer(profile["target"], 10000, 5000000):
        raise ValueError("Некорректная сумма цели")
    if "notifications" in profile and type(profile["notifications"]) is not bool:
        raise ValueError("Некорректная настройка уведомлений")
    for employee in entities(value.get("employees")):
        if not isinstance(employee.get("name"), str) or not employee["name"].strip() or len(employee["name"]) > 30 or type(employee.get("active")) is not bool:
            raise ValueError("Проверьте данные сотрудника")
        for field, limit in (("role", 40), ("bio", 180), ("goal", 60), ("initials", 30), ("photo", 2000), ("color", 40), ("cardLast4", 4)):
            if field in employee and (not isinstance(employee[field], str) or len(employee[field]) > limit):
                raise ValueError("Проверьте данные сотрудника")
        if "goalTarget" in employee and not integer(employee["goalTarget"], 10000, 5000000):
            raise ValueError("Некорректная сумма цели сотрудника")
        if "notifications" in employee and type(employee["notifications"]) is not bool:
            raise ValueError("Некорректная настройка уведомлений")
    if recipients is not None and not set(recipients).issubset({employee["id"] for employee in value["employees"]}):
        raise ValueError("Получатель отсутствует в команде")
    for tip in entities(value.get("tips")):
        allocations = tip.get("allocations")
        if not integer(tip.get("amount"), 1, 5000000) or not isinstance(allocations, dict):
            raise ValueError("Некорректная сумма чаевых")
        for employee_id, amount in allocations.items():
            identifier(employee_id)
            if not integer(amount, 0, 5000000):
                raise ValueError("Некорректное распределение")
        if allocations and sum(allocations.values()) != tip["amount"]:
            raise ValueError("Сумма распределения не совпадает с чаевыми")
        if not integer(tip.get("rating"), 0, 5) or not isinstance(tip.get("comment"), str) or len(tip["comment"]) > 500:
            raise ValueError("Некорректный отзыв")
        if not isinstance(tip.get("tags"), list) or len(tip["tags"]) > 5 or any(not isinstance(tag, str) or len(tag) > 60 for tag in tip["tags"]):
            raise ValueError("Некорректные теги отзыва")
        if not timestamp(tip.get("date")) or type(tip.get("reviewed")) is not bool or tip.get("method") not in ("СБП", "Карта", "Alfa Pay", "Альфа-Пэй") or tip.get("source") not in ("guest", "seed"):
            raise ValueError("Некорректная операция")
        if "oranges" in tip and not integer(tip["oranges"], 0, 1000):
            raise ValueError("Некорректные бонусы операции")
    for withdrawal in entities(value.get("withdrawals")):
        if not integer(withdrawal.get("amount"), 1, 9007199254740991) or not timestamp(withdrawal.get("date")):
            raise ValueError("Некорректный вывод")
        identifier(withdrawal.get("employeeId", "alex"))
    events = value["oranges"].get("events")
    if not isinstance(events, list) or len(events) > 10000:
        raise ValueError("Некорректные бонусы")
    for event in events:
        if not isinstance(event, dict) or not integer(event.get("amount"), 0, 1000):
            raise ValueError("Некорректное начисление бонусов")
        identifier(event.get("tipId"))
        if not timestamp(event.get("date")) or event.get("method") not in ("СБП", "Карта", "Alfa Pay", "Альфа-Пэй"):
            raise ValueError("Некорректное начисление бонусов")
    if len({event["tipId"] for event in events}) != len(events) or not integer(value["oranges"].get("balance"), 0, 9007199254740991) or value["oranges"]["balance"] != sum(event["amount"] for event in events):
        raise ValueError("Некорректный баланс бонусов")
    return value


def validate_changes(current: dict, incoming: dict) -> None:
    """A general state save may not mint money, bonuses, or rewrite the ledger."""
    tips = {tip["id"]: tip for tip in current["tips"]}
    active = {employee["id"] for employee in current["employees"] if employee["active"]} & {employee["id"] for employee in incoming["employees"] if employee["active"]}
    for tip in incoming["tips"]:
        original = tips.get(tip["id"])
        if original is None:
            raise ValueError("Новые чаевые создаются только через API платежей")
        for field in ("amount", "method", "date", "source", "rating", "comment", "tags", "oranges"):
            if tip.get(field) != original.get(field):
                raise ValueError("Подтверждённую операцию нельзя изменить")
        if original["allocations"] and tip["allocations"] != original["allocations"]:
            raise ValueError("Распределённые чаевые нельзя изменить")
        if not original["allocations"] and not set(tip["allocations"]).issubset(active):
            raise ValueError("Получатель больше не принимает чаевые")
    if incoming["oranges"] != current["oranges"]:
        raise ValueError("Бонусы начисляются только сервером при оплате")
    withdrawals = {item["id"]: item for item in current["withdrawals"]}
    available: dict[str, int] = {}
    for tip in current["tips"]:
        for person, amount in tip["allocations"].items():
            available[person] = available.get(person, 0) + amount
    for item in current["withdrawals"]:
        person = item.get("employeeId", "alex")
        available[person] = available.get(person, 0) - item["amount"]
    for item in incoming["withdrawals"]:
        original = withdrawals.get(item["id"])
        if original is not None:
            if item != original:
                raise ValueError("Подтверждённый вывод нельзя изменить")
            continue
        person = item.get("employeeId", "alex")
        if item["amount"] > available.get(person, 0):
            raise ValueError("Недостаточно средств для вывода")
        available[person] -= item["amount"]


def detached(value: dict) -> dict:
    return deepcopy(value)
