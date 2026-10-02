with open('frontend/src/pages/PosPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    'async function confirmCheckout(method: PaymentMethod, amountPaid: number | null) {',
    'async function confirmCheckout(method: PaymentMethod, amountPaid: number | null, dueDate: string | null = null) {'
)

content = content.replace(
    'offline_created_at: new Date().toISOString(),',
    'offline_created_at: new Date().toISOString(),\n      due_date: dueDate,'
)

content = content.replace(
    'void_at: null,\n  };',
    'voided_at: null,\n    due_date: payload.due_date ?? null,\n    piutang_status: payload.payment_method === \"piutang\" ? \"unpaid\" : null,\n  };'
)
content = content.replace(
    'voided_at: null,\n  };',
    'voided_at: null,\n    due_date: payload.due_date ?? null,\n    piutang_status: payload.payment_method === \"piutang\" ? \"unpaid\" : null,\n  };'
)

content = content.replace(
    'onConfirm={(method, amountPaid) => void confirmCheckout(method, amountPaid)}',
    'onConfirm={(method, amountPaid, dueDate) => void confirmCheckout(method, amountPaid, dueDate)}'
)


with open('frontend/src/pages/PosPage.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
