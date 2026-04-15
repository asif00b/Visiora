"""Update system_config values in the DB."""
import pymysql
conn = pymysql.connect(
    host='localhost', port=3306, user='root', password='',
    database='attendance_db', charset='utf8mb4'
)
cursor = conn.cursor()
updates = [
    ('face_register_model', 'hog'),
    ('min_face_size_px',    '50'),
    ('face_detection_model','hog'),
    ('recognition_tolerance','0.50'),
]
for key, val in updates:
    cursor.execute('UPDATE system_config SET value=%s WHERE `key`=%s', (val, key))
    print(f'  Updated {key} = {val}  ({cursor.rowcount} row)')
conn.commit()
cursor.close()
conn.close()
print('Done.')
