"""
create_mysql_db.py
------------------
Run ONCE before starting the app to create the MySQL database in XAMPP.
Usage:  python create_mysql_db.py
"""

import sys

try:
    import pymysql
except ImportError:
    print("[ERROR] PyMySQL not installed. Run:  pip install PyMySQL cryptography")
    sys.exit(1)

# ── Connection settings (match config.py) ────────────────────────────────────
HOST     = 'localhost'
PORT     = 3306
USER     = 'root'
PASSWORD = ''            # XAMPP default is empty; change if you set one
DB_NAME  = 'attendance_db'

print(f"\n{'='*55}")
print("  Face Recognition System — MySQL Database Setup")
print(f"{'='*55}\n")

try:
    # Connect WITHOUT specifying a database first
    conn = pymysql.connect(
        host=HOST,
        port=PORT,
        user=USER,
        password=PASSWORD,
        charset='utf8mb4',
        connect_timeout=5,
    )
    cursor = conn.cursor()

    # Create database with full Unicode support (emoji, Arabic, etc.)
    cursor.execute(
        f"CREATE DATABASE IF NOT EXISTS `{DB_NAME}` "
        f"CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    )
    conn.commit()

    # Verify it exists
    cursor.execute("SHOW DATABASES LIKE %s;", (DB_NAME,))
    result = cursor.fetchone()
    if result:
        print(f"[OK] Database '{DB_NAME}' is ready.")
    else:
        print(f"[ERROR] Database '{DB_NAME}' was not created.")
        sys.exit(1)

    cursor.close()
    conn.close()

    print("[OK] XAMPP MySQL connection successful.")
    print("[OK] Tables will be created automatically when you run app.py.\n")

except pymysql.err.OperationalError as e:
    code, msg = e.args
    if code == 2003:
        print(f"[ERROR] Cannot connect to MySQL at {HOST}:{PORT}")
        print("        -> Make sure XAMPP MySQL is RUNNING (green light in XAMPP control panel)")
    elif code == 1045:
        print(f"[ERROR] Access denied for user '{USER}'")
        print("        -> Check your MySQL username/password in create_mysql_db.py")
    else:
        print(f"[ERROR] MySQL error {code}: {msg}")
    sys.exit(1)
except Exception as e:
    print(f"[ERROR] Unexpected error: {e}")
    sys.exit(1)
