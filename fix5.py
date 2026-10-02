with open('frontend/src/components/pos/PiutangReminderPanel.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('?\"', '—')

with open('frontend/src/components/pos/PiutangReminderPanel.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
