with open('frontend/src/lib/types.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()
with open('frontend/src/lib/types.ts', 'w', encoding='utf-8') as f:
    for i, line in enumerate(lines):
        f.write(line)
        if 'offline_created_at?: string;' in line:
            f.write('  due_date?: string | null;\n')
