export const bookshopSources = [
  {
    id: 'bookshop-app',
    repo: 'demo/bookshop',
    revision: 'main',
    file: 'bookshop.kontur',
    enabled: true,
    code: `workspace "Harbor Books · Anwendung" {
  namespace "demo.harbor-books"

  model {
    harbor = organization "Harbor Books"
    commerce = team "Commerce Team"
    logistics = team "Logistics Team"
    anna = person "Anna Berger"
    ben = person "Ben Hoffmann"
    clara = person "Clara Nguyen"
    customer = actor "Leserin oder Leser"

    commerce partOf harbor { source "Organigramm" }
    logistics partOf harbor
    anna partOf commerce

    shop = system "Bookshop" {
      stages dev, stage, prod
      owner commerce source "Architekturmodell"
      businessOwner anna
      businessOwner ben
      businessTeam commerce
      technicalOwner clara

      web = container "Storefront" {
        technology "React"
      }

      orders = service "Order Service" {
        technology "Go"
        responsibilities {
          architect clara
        }
        checkout = component "Checkout Handler"
        repository = component "Order Repository"
      }

      db = datastore "Orders Database" {
        technology "PostgreSQL"
      }

      api events "Order Events" {
        mode async
        protocol kafka
        lifecycle active
        contract asyncapi "./contracts/order-events.yaml"
        owner commerce
        usesCapability core.messaging
        usesCapability core.observability

        topic created "orders.created"
        topic cancelled "orders.cancelled"
      }

      orders publishes events.created
      orders publishes events.cancelled
    }

    shipping = system "Shipping" {
      owner logistics
      fulfillment = service "Fulfillment" {
        technology "Rust"
      }
    }

    ordersApi = api "Orders API" {
      mode sync
      protocol http
      style rest
      interaction requestResponse
      contract openapi "./contracts/orders.yaml"
      lifecycle active
      owner commerce
    }

    shippingQuotes = api "Shipping Quotes" {
      mode sync
      protocol grpc
      contract protobuf "./contracts/shipping.proto"
      owner logistics
    }

    customer -> web "Bestellt Bücher"
    web consumes ordersApi {
      operations "listOrders", "createOrder"
    }
    fulfillment consumes ordersApi {
      operations "listOrders"
    }
    fulfillment provides shippingQuotes
    orders consumes shippingQuotes { operations "quoteShipping" }
    fulfillment subscribes shop.events.created
    fulfillment subscribes shop.events.cancelled
    orders provides ordersApi
    checkout dependsOn repository
    repository dependsOn db
    orders dependsOn db "Speichert Bestellungen"

    // Referenz für die Einzelansicht. Das Plattform-Repo ergänzt die Details.
    platform core "Core Platform" {
      capability messaging "Event Streaming"
      capability observability "Observability"
      environment shared "Shared"
      environment production "Production"
    }

    dev = deploymentEnvironment "Entwicklung" {
      laptop = deploymentNode "Entwicklungsrechner" {
        technology "Docker Compose"
        storefront = containerInstance web
        orderService = containerInstance orders
        ordersDatabase = containerInstance db
      }
    }

    prod = deploymentEnvironment "Produktion" {
      cluster = deploymentNode "EKS Production" {
        technology "Kubernetes"
        ingress = infrastructureNode "Ingress Controller"
        shop = deploymentNode "Namespace bookshop" {
          storefront = containerInstance web
          orderService = containerInstance orders
        }
        shipping = deploymentNode "Namespace shipping" {
          fulfillmentService = containerInstance fulfillment
        }
      }
      data = deploymentNode "RDS Production" {
        technology "Amazon RDS"
        ordersDatabase = containerInstance db
      }
    }

    prod.cluster.ingress -> prod.cluster.shop.storefront "Leitet HTTPS weiter"
    prod.cluster runsIn core.production { source "Plattformkatalog" }
  }

  bindings {
    shop.events@dev uses core.messaging@shared
    shop.events@stage uses core.messaging@shared
    shop.events@prod uses core.messaging@production
    shop.events@prod uses core.observability@production
  }

  views {
    deployment "Harbor Books · Produktion" { environment prod stage prod include * autoLayout lr }
    deployment "Harbor Books · Entwicklung" { environment dev stage dev include * autoLayout lr }
    landscape "Harbor Books · Systemlandschaft" { autoLayout lr }
    containers "Bookshop · Container" { scope shop autoLayout lr }
    components "Order Service · Komponenten" { scope orders autoLayout lr }
    apis "Harbor Books · Schnittstellen" { autoLayout lr }
    ownership "Harbor Books · Zuständigkeiten" { autoLayout tb }
  }
}`,
  },
  {
    id: 'bookshop-platform',
    repo: 'demo/bookshop-platform',
    revision: 'main',
    file: 'platform.kontur',
    enabled: true,
    code: `workspace "Harbor Books · Plattform" {
  namespace "demo.harbor-books"

  model {
    harbor = organization "Harbor Books"
    team platformTeam "Platform Engineering"
    person svea "Svea Fenn"
    person noah "Noah Quell"
    person jara "Jara Westen"
    platformTeam partOf harbor

    platform core "Core Platform" {
      lifecycle active
      productOwner svea
      productOwner noah
      technicalOwner jara
      technicalTeam platformTeam

      capability runtime "Application Runtime" {
        technology "Kubernetes"
      }
      capability messaging "Event Streaming" {
        technology "Kafka"
      }
      capability observability "Observability" {
        technology "Grafana / Mimir / Loki"
      }

      environment shared "Shared"
      environment production "Production"
    }
  }

  views {
    platformCapabilities "Harbor Books · Plattformfähigkeiten"
    technicalDependencies "Harbor Books · Technische Abhängigkeiten"
  }
}`,
  },
  {
    id: 'bookshop-operations',
    repo: 'demo/bookshop-operations',
    revision: 'main',
    file: 'operations.kontur',
    enabled: true,
    code: `workspace "Harbor Books · Betrieb" {
  namespace "demo.harbor-books"

  model {
    harbor = organization "Harbor Books"
    northPier = organization "North Pier Logistics" { external true }
    operations = team "Managed Operations"
    clara = person "Clara Nguyen"
    mara = person "Mara Düne"
    operations partOf northPier { source "Leistungsbeschreibung" }

    shop = system "Bookshop" {
      owner operations source "Betriebskatalog"
      businessOwner mara
      technicalOwner clara
      technicalTeam operations
    }

    shipping = system "Shipping"
    dispatch = businessProcess "Buchbestellungen versenden" {
      owner operations
    }

    shop developedBy harbor
    shop operatedBy northPier { source "Betriebsvertrag" }
    dispatch providedBy northPier
    dispatch customer harbor
    dispatch supportedBy shipping
  }

  views {
    ownership "Harbor Books · Betrieb und Versand" { autoLayout lr }
  }
}`,
  },
  {
    id: 'bookshop-inventory',
    repo: 'demo/bookshop-inventory',
    revision: 'main',
    file: 'inventory.kontur',
    enabled: false,
    code: `workspace "Harbor Books · Inventar" {
  namespace "demo.harbor-books"

  model {
    // Mit demo/bookshop kombinieren: Das Inventar meldet eine andere Technologie.
    shop = system "Bookshop" {
      web = container "Storefront" {
        technology "Vue"
      }
    }
  }
}`,
  },
];

export const standaloneExamples = [
  {
    id: 'events',
    title: 'Aurora Weather',
    subtitle: 'Events · Kafka · AsyncAPI',
    description: 'Ein synthetisches Wetterdatensystem, das Nachrichten veröffentlicht und von mehreren Anwendungen konsumieren lässt.',
    code: `workspace "Aurora Weather" {
  namespace "demo.aurora"

  model {
    dataTeam = team "Data Platform"
    appTeam = team "Applications"

    telemetry = system "Telemetry" {
      owner dataTeam
      collector = service "Station Collector" {
        technology "Rust"
      }
    }

    weather = system "Weather Apps" {
      owner appTeam
      alerts = service "Alert Engine"
      dashboard = container "Weather Dashboard" {
        technology "Vue"
      }
    }

    observations = api "Weather Observations" {
      interaction publishSubscribe
      protocol kafka
      produces "weather.observations", "weather.station-status"
      consumes "weather.calibration"
      contract asyncapi "./contracts/weather.yaml"
      lifecycle active
      owner dataTeam
    }

    collector publishes observations { topics "weather.observations", "weather.station-status" }
    collector subscribes observations { topics "weather.calibration" }
    alerts subscribes observations { topics "weather.observations" }
    dashboard subscribes observations { topics "weather.observations", "weather.station-status" }
  }

  views {
    apis "Event subscriptions" {
      autoLayout lr
    }
    landscape "Systems" {
      autoLayout lr
    }
  }
}`,
  },
  {
    id: 'components',
    title: 'Studio Notes',
    subtitle: 'Components · gRPC · People',
    description: 'Eine kleine Notizanwendung mit Komponenten, einer gRPC-Schnittstelle und benannten Architekturverantwortlichen.',
    code: `workspace "Studio Notes" {
  namespace "demo.studio-notes"

  model {
    product = team "Product Engineering"
    mia = person "Mia Weber"
    noah = person "Noah Fischer"

    notes = system "Notes" {
      responsibilities {
        owner product
        businessOwner mia
        architect noah
      }

      editor = container "Notes Editor" {
        technology "TypeScript"
      }

      backend = service "Notes Backend" {
        technology "Go"
        handler = component "Request Handler"
        repository = component "Note Repository"
      }

      store = datastore "Notes Store" {
        technology "SQLite"
      }
    }

    notesRpc = api "Notes RPC" {
      interaction requestResponse
      protocol grpc
      contract protobuf "./contracts/notes.proto"
      owner product
    }

    backend provides notesRpc
    editor consumes notesRpc
    handler dependsOn repository
    repository dependsOn store
  }

  views {
    components "Component detail" {
      autoLayout lr
    }
    apis "RPC contracts" {
      autoLayout lr
    }
    ownership "Ownership" {
      autoLayout tb
    }
  }
}`,
  },
].map(({ id, code }) => ({
  id, code, repo: `demo/${id}`, revision: 'main', enabled: false,
}));

export const builtInSources = [...bookshopSources, ...standaloneExamples];
