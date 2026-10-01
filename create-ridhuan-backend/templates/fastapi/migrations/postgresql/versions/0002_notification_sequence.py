"""Commit ordered notification cursors and guaranteed cache generation row."""

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: None = None
depends_on: None = None


def upgrade() -> None:
    op.add_column("notifications", sa.Column("sequence", sa.BigInteger(), nullable=True))
    op.execute(
        "UPDATE notifications AS n SET sequence = ordered.sequence FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY recipient_id ORDER BY created_at, id) AS sequence FROM notifications) AS ordered WHERE n.id = ordered.id"
    )
    op.alter_column("notifications", "sequence", existing_type=sa.BigInteger(), nullable=False)
    op.create_unique_constraint(
        "uq_notification_sequence", "notifications", ["recipient_id", "sequence"]
    )
    op.execute(
        "INSERT INTO cache_generation (id, version) VALUES (1, 0) ON CONFLICT (id) DO NOTHING"
    )


def downgrade() -> None:
    op.drop_constraint("uq_notification_sequence", "notifications", type_="unique")
    op.drop_column("notifications", "sequence")
