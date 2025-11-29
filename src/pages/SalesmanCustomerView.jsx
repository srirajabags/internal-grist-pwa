import React from 'react';
import CustomerConversationView from '../components/CustomerConversationView';

const SalesmanCustomerView = (props) => {
    return (
        <CustomerConversationView
            {...props}
            defaultMedium="IN PERSON"
            defaultOutcome="NO REQUIREMENT"
            enableLocationUpdate={true}
            title="Salesman Visit"
        />
    );
};

export default SalesmanCustomerView;
