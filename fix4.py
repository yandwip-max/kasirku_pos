with open('frontend/src/pages/PosPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    'import CheckoutDialog from "@/components/pos/CheckoutDialog";',
    'import CheckoutDialog from "@/components/pos/CheckoutDialog";\nimport PiutangReminderPanel from "@/components/pos/PiutangReminderPanel";'
)

content = content.replace(
    '<LowStockAlert />\n          <div className="px-4 pt-3 lg:px-4">\n            <AttendancePanel />',
    '<LowStockAlert />\n          <div className="px-4 pt-3 lg:px-4">\n            <AttendancePanel />\n            <PiutangReminderPanel />'
)

with open('frontend/src/pages/PosPage.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
