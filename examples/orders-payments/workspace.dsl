workspace "Orders and payments" {
    !impliedRelationships false

    model {
        operations_analyst = person "Operations Analyst" "Reviews orders and investigates delayed payments."

        order_hub = softwareSystem "Order Hub" "Accepts customer orders and coordinates fulfillment." {
            storefront = container "Customer storefront" "Lets customers review and submit orders." "TypeScript · React"
            order_api = container "Order management API" "Coordinates order state, pricing and payment requests." "Rust · HTTP/JSON"
            order_db = container "Orders and audit database" "Stores orders and their audit history." "PostgreSQL" {
                tags "Database"
            }
        }

        payment_network = softwareSystem "Payment Network" "Authorizes payments and records settlement events." {
            payment_api = container "Payment authorization API" "Authorizes a payment and tracks its provider status." "Kotlin · HTTP/JSON"
            payment_db = container "Settlement ledger database" "Stores authorization and settlement events." "PostgreSQL" {
                tags "Database"
            }
        }

        email_provider = softwareSystem "E-Mail Provider" "E-Mail SaaS" {
            email_server = container "E-Mail Provider" "Sends E-Mails" "SaaS"
        }

        r_user_storefront = operations_analyst -> storefront "Reviews and places orders"
        r_storefront_order_status = storefront -> order_api "Loads the current order and delivery status"
        r_storefront_order_submit = storefront -> order_api "Submits an order with its idempotency key"
        r_order_db = order_api -> order_db "Reads and writes orders" "SQL"
        r_order_payment_auth = order_api -> payment_api "Requests authorization with customer and currency context" "HTTPS/JSON"
        r_order_payment_status = order_api -> payment_api "Queries transaction status after a timeout" "HTTPS/JSON"
        r_payment_db = payment_api -> payment_db "Records authorization and settlement events" "SQL"
        r_payment_order_result = payment_api -> order_api "Returns authorization result and provider reference" "HTTPS/JSON"
        r_payment_confirmation = payment_api -> email_server "Sends Confirmation Mail" "HTTP"
    }

    views {
        container order_hub "orders-payments" {
            include operations_analyst storefront order_api order_db payment_api payment_db email_server
            autoLayout lr
        }
    }
}
