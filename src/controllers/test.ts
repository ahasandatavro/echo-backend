{
    "chatbot": {
        "id": 28,
        "name": "actions",
        "description": "Generated flow",
        "triggered": false,
        "stepsFinished": null,
        "finished": false,
        "startNodeId": null,
        "ownerId": null,
        "status": "ACTIVE",
        "createdAt": "2025-02-01T06:32:20.950Z",
        "updatedAt": "2025-02-01T06:32:20.950Z"
    },
    "nodes": [
        {
            "id": 772,
            "chatId": 28,
            "nodeId": "lwptspIrYgIDmAhnIQT0L",
            "data": {
                "icon": "message",
                "label": "Subscribe",
                "description": ""
            },
            "type": "subscribe",
            "positionX": 832.8645935058594,
            "positionY": 62.12763977050787,
            "createdAt": "2025-02-01T07:20:44.904Z",
            "updatedAt": "2025-02-01T07:20:44.904Z"
        },
        {
            "id": 773,
            "chatId": 28,
            "nodeId": "6XOcMvMAPUrClqa06uYrL",
            "data": {
                "icon": "button",
                "label": "Unsubscribe",
                "description": ""
            },
            "type": "unsubscribe",
            "positionX": 845.8645935058594,
            "positionY": 165.0182342529297,
            "createdAt": "2025-02-01T07:20:44.904Z",
            "updatedAt": "2025-02-01T07:20:44.904Z"
        },
        {
            "id": 775,
            "chatId": 28,
            "nodeId": "rKsy5hKVht2BvL_H865A8",
            "data": {
                "icon": "card",
                "label": "Trigger Chatbot",
                "description": ""
            },
            "type": "triggerChatbot",
            "positionX": 1188.864593505859,
            "positionY": 329.0182342529297,
            "createdAt": "2025-02-01T07:20:44.904Z",
            "updatedAt": "2025-02-01T07:20:44.904Z"
        },
        {
            "id": 776,
            "chatId": 28,
            "nodeId": "PDx49lfncj_g8rz1GyeL3",
            "data": {
                "icon": "card",
                "label": "Set tags",
                "tags_data": {
                    "selectedTags": [
                        "Urgent"
                    ]
                },
                "description": ""
            },
            "type": "setTags",
            "positionX": 1498.864593505859,
            "positionY": 61.01823425292969,
            "createdAt": "2025-02-01T07:20:44.904Z",
            "updatedAt": "2025-02-01T07:20:44.904Z"
        },
        {
            "id": 777,
            "chatId": 28,
            "nodeId": "x1cv0nCBb-7XDFm9hQhiL",
            "data": {
                "icon": "card",
                "label": "Update Attribute",
                "description": "",
                "attribute_data": {
                    "attributes": [
                        {
                            "key": "@category",
                            "value": "@attribute"
                        },
                        {
                            "key": "type",
                            "value": "newUser"
                        }
                    ]
                }
            },
            "type": "updateAttribute",
            "positionX": 2159.864593505859,
            "positionY": 65.01823425292969,
            "createdAt": "2025-02-01T07:20:44.904Z",
            "updatedAt": "2025-02-01T07:20:44.904Z"
        },
        {
            "id": 778,
            "chatId": 28,
            "nodeId": "oH9B9KrmJ9uKqfXJYE-fk",
            "data": {
                "icon": "card",
                "label": "Update Chat Status",
                "description": "",
                "chat_status_data": {
                    "selectedStatus": "Solved"
                }
            },
            "type": "updateChatStatus",
            "positionX": 2919.864593505859,
            "positionY": 34.01823425292969,
            "createdAt": "2025-02-01T07:20:44.904Z",
            "updatedAt": "2025-02-01T07:20:44.904Z"
        },
        {
            "id": 780,
            "chatId": 28,
            "nodeId": "S37DuhjObHB9CNfZ5Oyhe",
            "data": {
                "icon": "card",
                "label": "Update Chat Status",
                "description": "",
                "chat_status_data": {
                    "selectedStatus": "Pending"
                }
            },
            "type": "updateChatStatus",
            "positionX": 2904.864593505859,
            "positionY": 218.0182342529297,
            "createdAt": "2025-02-01T07:20:44.904Z",
            "updatedAt": "2025-02-01T07:20:44.904Z"
        },
        {
            "id": 781,
            "chatId": 28,
            "nodeId": "rWgcGXc0kk5BhYNqsRgyS",
            "data": {
                "icon": "card",
                "label": "Template",
                "description": "",
                "template_data": {
                    "selectedTemplate": "Follow-up Reminder"
                }
            },
            "type": "template",
            "positionX": 862.6646301269532,
            "positionY": 291.0182342529297,
            "createdAt": "2025-02-01T07:20:44.904Z",
            "updatedAt": "2025-02-01T07:20:44.904Z"
        }
    ],
    "edges": [
        {
            "id": 670,
            "chatId": 28,
            "sourceId": 774,
            "targetId": 771,
            "sourceHandle": "source",
            "createdAt": "2025-02-01T07:20:44.959Z",
            "updatedAt": "2025-02-01T07:20:44.959Z"
        },
        {
            "id": 671,
            "chatId": 28,
            "sourceId": 771,
            "targetId": 772,
            "sourceHandle": "source_0",
            "createdAt": "2025-02-01T07:20:44.959Z",
            "updatedAt": "2025-02-01T07:20:44.959Z"
        },
        {
            "id": 672,
            "chatId": 28,
            "sourceId": 771,
            "targetId": 773,
            "sourceHandle": "source_1",
            "createdAt": "2025-02-01T07:20:44.959Z",
            "updatedAt": "2025-02-01T07:20:44.959Z"
        },
        {
            "id": 673,
            "chatId": 28,
            "sourceId": 773,
            "targetId": 775,
            "sourceHandle": "source",
            "createdAt": "2025-02-01T07:20:44.959Z",
            "updatedAt": "2025-02-01T07:20:44.959Z"
        },
        {
            "id": 674,
            "chatId": 28,
            "sourceId": 772,
            "targetId": 770,
            "sourceHandle": "source",
            "createdAt": "2025-02-01T07:20:44.959Z",
            "updatedAt": "2025-02-01T07:20:44.959Z"
        },
        {
            "id": 675,
            "chatId": 28,
            "sourceId": 770,
            "targetId": 776,
            "sourceHandle": "source_0",
            "createdAt": "2025-02-01T07:20:44.959Z",
            "updatedAt": "2025-02-01T07:20:44.959Z"
        },
        {
            "id": 676,
            "chatId": 28,
            "sourceId": 776,
            "targetId": 769,
            "sourceHandle": "source",
            "createdAt": "2025-02-01T07:20:44.959Z",
            "updatedAt": "2025-02-01T07:20:44.959Z"
        },
        {
            "id": 677,
            "chatId": 28,
            "sourceId": 769,
            "targetId": 777,
            "sourceHandle": "source_0",
            "createdAt": "2025-02-01T07:20:44.959Z",
            "updatedAt": "2025-02-01T07:20:44.959Z"
        },
        {
            "id": 678,
            "chatId": 28,
            "sourceId": 779,
            "targetId": 778,
            "sourceHandle": "source_0",
            "createdAt": "2025-02-01T07:20:44.959Z",
            "updatedAt": "2025-02-01T07:20:44.959Z"
        },
        {
            "id": 679,
            "chatId": 28,
            "sourceId": 779,
            "targetId": 780,
            "sourceHandle": "source_1",
            "createdAt": "2025-02-01T07:20:44.959Z",
            "updatedAt": "2025-02-01T07:20:44.959Z"
        },
        {
            "id": 680,
            "chatId": 28,
            "sourceId": 777,
            "targetId": 779,
            "sourceHandle": "source",
            "createdAt": "2025-02-01T07:20:44.959Z",
            "updatedAt": "2025-02-01T07:20:44.959Z"
        },
        {
            "id": 681,
            "chatId": 28,
            "sourceId": 771,
            "targetId": 781,
            "sourceHandle": "source_2",
            "createdAt": "2025-02-01T07:20:44.959Z",
            "updatedAt": "2025-02-01T07:20:44.959Z"
        }
    ]
}