"""session families and email outbox

Revision ID: 0003
Revises: 0002
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.database.base import UTCInstant
from app.database.types import Guid

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "refresh_families",
        sa.Column("id", Guid(), primary_key=True),
        sa.Column("user_id", Guid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("expires_at", UTCInstant(), nullable=False),
        sa.Column("revoked_at", UTCInstant(), nullable=True),
        sa.Column("created_at", UTCInstant(), nullable=False),
    )
    # Consumed tokens have revoked_at set; only a family with no live token is revoked.
    op.execute(
        "INSERT INTO refresh_families (id,user_id,expires_at,revoked_at,created_at) SELECT family_id,user_id,MAX(expires_at),CASE WHEN SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END)=0 THEN MAX(revoked_at) ELSE NULL END,MIN(created_at) FROM refresh_tokens GROUP BY family_id,user_id"
    )
    op.create_index("ix_family_retention", "refresh_families", ["expires_at", "revoked_at"])
    op.create_foreign_key(
        "fk_refresh_family",
        "refresh_tokens",
        "refresh_families",
        ["family_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_table(
        "notification_counters",
        sa.Column(
            "recipient_id", Guid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("sequence", sa.BigInteger(), nullable=False),
    )
    op.execute(
        "INSERT INTO notification_counters (recipient_id,sequence) SELECT recipient_id,MAX(sequence) FROM notifications GROUP BY recipient_id"
    )
    op.create_table(
        "email_jobs",
        sa.Column("id", Guid(), primary_key=True),
        sa.Column(
            "notification_id",
            Guid(),
            sa.ForeignKey("notifications.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("recipient", sa.String(255), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("body", sa.String(4000), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("available_at", UTCInstant(), nullable=False),
        sa.Column("lease_until", UTCInstant(), nullable=True),
        sa.Column("lease_id", Guid(), nullable=True),
        sa.Column("completed_at", UTCInstant(), nullable=True),
        sa.Column("created_at", UTCInstant(), nullable=False),
    )
    op.create_index("ix_email_claim", "email_jobs", ["status", "available_at", "lease_until"])
    # An old PENDING row has no durable job; avoid blindly repeating prior SMTP.
    op.execute("UPDATE notifications SET email_status='FAILED' WHERE email_status='PENDING'")


def downgrade() -> None:
    op.drop_table("email_jobs")
    op.drop_table("notification_counters")
    op.drop_constraint("fk_refresh_family", "refresh_tokens", type_="foreignkey")
    op.drop_table("refresh_families")
