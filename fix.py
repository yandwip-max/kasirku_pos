with open('frontend/src/lib/types.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()
with open('frontend/src/lib/types.ts', 'w', encoding='utf-8') as f:
    for i, line in enumerate(lines):
        f.write(line)
        if 'created_at: string;' in line and 'client_ref' in lines[i-1]:
            f.write('  due_date: string | null;\n')
            f.write('  piutang_status: \"unpaid\" | \"paid\" | null;\n')
